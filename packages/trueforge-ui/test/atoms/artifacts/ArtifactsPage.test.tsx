// @vitest-environment jsdom
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { ArtifactsButton } from '@/atoms/ArtifactsButton.js';
import { ArtifactsPage } from '@/atoms/artifacts/ArtifactsPage.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useOptionalShellMode } from '@/server/ShellModeContext.js';
import type { Artifact, ArtifactServer } from '@/server/types.js';
import { createMockAgentUIServer, createMockArtifactServer, createMockCatalog } from '../../server/mockServer.js';

const subject = { subjectId: 'user-1', subjectType: 'user', subjectDisplayName: 'alice' };

function artifact(overrides: Partial<Artifact> & Pick<Artifact, 'id' | 'name'>): Artifact {
  return {
    createdBySubject: subject,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

const q4Brief = artifact({ id: 'a1', name: 'Q4 brief' });
const sample = [q4Brief, artifact({ id: 'a2', name: 'Eval results' })];

// FilePreviewProvider reads thread state, so the page needs a runtime like the real layouts give it.
function WithRuntime({ children }: { children: ReactNode }) {
  const runtime = useExternalStoreRuntime({
    messages: [] as ThreadMessageLike[],
    isRunning: false,
    convertMessage: (next: ThreadMessageLike) => next,
    onNew: async () => {},
  });
  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

function renderWith(artifactServer: ArtifactServer | undefined, ui = <ArtifactsPage />) {
  const server = createMockAgentUIServer({
    catalog: createMockCatalog(),
    ...(artifactServer === undefined ? {} : { artifacts: artifactServer }),
  });
  return render(
    <WithRuntime>
      <ServerProvider server={server}>
        <ShellModeProvider agentConfig={{ mode: 'AgentLibraryWithComposer' }}>{ui}</ShellModeProvider>
      </ServerProvider>
    </WithRuntime>,
  );
}

beforeAll(() => {
  // jsdom has no <dialog> modal support, which the edit dialog relies on.
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('ArtifactsPage', () => {
  it('lists artifacts with the creator name and without type or version', async () => {
    renderWith(createMockArtifactServer({ listArtifacts: vi.fn(async () => ({ data: sample })) }));
    expect(await screen.findByText('Q4 brief')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Created by' })).toBeInTheDocument();
    expect(screen.getAllByText('alice')).toHaveLength(2);
    expect(screen.queryByRole('columnheader', { name: 'Type' })).not.toBeInTheDocument();
    expect(screen.queryByRole('columnheader', { name: 'Version' })).not.toBeInTheDocument();
    expect(screen.queryByText('v2')).not.toBeInTheDocument();
  });

  it('shows the empty state and a friendly load error', async () => {
    const { unmount } = renderWith(createMockArtifactServer());
    expect(await screen.findByRole('heading', { name: 'No artifacts yet' })).toBeInTheDocument();
    unmount();

    renderWith(
      createMockArtifactServer({
        listArtifacts: vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      }),
    );
    expect(await screen.findByRole('heading', { name: "Couldn't load artifacts" })).toBeInTheDocument();
    expect(screen.queryByText('Failed to fetch')).not.toBeInTheDocument();
  });

  it('offers no owner filter, since the list API has no scope param yet', async () => {
    renderWith(createMockArtifactServer({ listArtifacts: async () => ({ data: sample }) }));
    await screen.findByText('Q4 brief');
    expect(screen.queryByRole('button', { name: 'Filter artifacts' })).not.toBeInTheDocument();
  });

  it('sends the debounced search text as name', async () => {
    const listArtifacts = vi.fn(async () => ({ data: sample }));
    renderWith(createMockArtifactServer({ listArtifacts }));
    await screen.findByText('Q4 brief');
    fireEvent.change(screen.getByPlaceholderText('Search artifacts by name'), { target: { value: ' brief ' } });
    await waitFor(() => expect(listArtifacts).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'brief' })));
  });

  it('opens the preview from a row click by reading the artifact file', async () => {
    const readArtifactFile = vi.fn(async () => new Blob(['# Hello'], { type: 'text/markdown' }));
    renderWith(createMockArtifactServer({ listArtifacts: async () => ({ data: sample }), readArtifactFile }));
    fireEvent.click(await screen.findByText('Q4 brief'));
    await waitFor(() => expect(readArtifactFile).toHaveBeenCalledWith({ id: 'a1' }));
  });

  it('puts the artifact in the URL on open, and deep-links by id', async () => {
    const readArtifactFile = vi.fn(async () => new Blob(['# Hello'], { type: 'text/markdown' }));
    const getArtifact = vi.fn(async () => q4Brief);
    const artifacts = createMockArtifactServer({
      listArtifacts: async () => ({ data: sample }),
      getArtifact,
      readArtifactFile,
    });
    function RefProbe() {
      const shell = useOptionalShellMode();
      // The shell only publishes artifactRef while the artifacts page is open.
      const opened = useRef(false);
      useEffect(() => {
        if (shell == null || opened.current) return;
        opened.current = true;
        shell.setArtifactsOpen(true);
      }, [shell]);
      return (
        <span data-testid="ref" data-open={shell?.artifactsOpen === true ? 'true' : 'false'}>
          {shell?.artifactRef ?? 'none'}
        </span>
      );
    }
    renderWith(
      artifacts,
      <>
        <ArtifactsPage />
        <RefProbe />
      </>,
    );
    await waitFor(() => expect(screen.getByTestId('ref')).toHaveAttribute('data-open', 'true'));
    fireEvent.click(await screen.findByText('Q4 brief'));
    await waitFor(() => expect(screen.getByTestId('ref')).toHaveTextContent('q4-brief--a1'));
    expect(getArtifact).not.toHaveBeenCalled();
  });

  it('renames an artifact from the row menu and refetches the list', async () => {
    const listArtifacts = vi.fn(async () => ({ data: sample }));
    const updateArtifact = vi.fn(async ({ id, name }: { id: string; name: string }) => artifact({ id, name }));
    renderWith(createMockArtifactServer({ listArtifacts, updateArtifact }));
    await screen.findByText('Q4 brief');
    const callsBefore = listArtifacts.mock.calls.length;

    fireEvent.click(screen.getByRole('button', { name: 'Actions for Q4 brief' }));
    fireEvent.click(await screen.findByText('Edit'));
    fireEvent.change(await screen.findByLabelText('Artifact name'), { target: { value: '  Q4 summary ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateArtifact).toHaveBeenCalledWith({ id: 'a1', name: 'Q4 summary' }));
    await waitFor(() => expect(listArtifacts.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('hides Share and Delete until the API supports them', async () => {
    renderWith(createMockArtifactServer({ listArtifacts: async () => ({ data: sample }) }));
    await screen.findByText('Q4 brief');
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Q4 brief' }));
    await screen.findByRole('menuitem', { name: 'Edit' });
    expect(screen.queryByRole('menuitem', { name: 'Share' })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Delete' })).not.toBeInTheDocument();
  });
});

describe('ArtifactsButton', () => {
  it('renders only when the artifacts port exists', () => {
    const withoutPort = renderWith(undefined, <ArtifactsButton compact />);
    expect(screen.queryByRole('button', { name: 'Artifacts' })).not.toBeInTheDocument();
    withoutPort.unmount();

    renderWith(createMockArtifactServer(), <ArtifactsButton compact />);
    const button = screen.getByRole('button', { name: 'Artifacts' });
    expect(button.querySelector('svg')).toHaveClass('lucide-gallery-horizontal-end');
  });
});
