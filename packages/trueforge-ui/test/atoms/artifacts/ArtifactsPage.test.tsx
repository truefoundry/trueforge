// @vitest-environment jsdom
import { AssistantRuntimeProvider, useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { ArtifactsButton } from '@/atoms/ArtifactsButton.js';
import { ArtifactsPage } from '@/atoms/artifacts/ArtifactsPage.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useOptionalShellMode } from '@/server/ShellModeContext.js';
import type { Artifact, ArtifactServer } from '@/server/types.js';
import { createMockAgentUIServer, createMockArtifactServer, createMockCatalog } from '../../server/mockServer.js';

const subject = { subjectId: 'user-1', subjectType: 'user', subjectDisplayName: 'alice' };

function artifact(overrides: Partial<Artifact> & Pick<Artifact, 'id' | 'name'>): Artifact {
  return {
    latestVersion: 2,
    entryPoint: 'report.md',
    createdBySubject: subject,
    createdBySessionId: 'session-1',
    createdByAgentId: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

const q4Brief = artifact({ id: 'a1', name: 'Q4 brief' });
const sample = [q4Brief, artifact({ id: 'a2', name: 'Empty draft', entryPoint: null })];

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

describe('ArtifactsPage', () => {
  it('lists artifacts with type and version', async () => {
    renderWith(createMockArtifactServer({ listArtifacts: vi.fn(async () => ({ data: sample })) }));
    expect(await screen.findByText('Q4 brief')).toBeInTheDocument();
    expect(screen.getAllByText('v2')).toHaveLength(2);
    expect(screen.getByText('Markdown')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
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
      return <span data-testid="ref">{useOptionalShellMode()?.artifactRef ?? 'none'}</span>;
    }
    renderWith(
      artifacts,
      <>
        <ArtifactsPage />
        <RefProbe />
      </>,
    );
    fireEvent.click(await screen.findByText('Q4 brief'));
    await waitFor(() => expect(screen.getByTestId('ref')).toHaveTextContent('q4-brief--a1'));
    expect(getArtifact).not.toHaveBeenCalled();
  });

  it('does not open a preview for an artifact without an entry file', async () => {
    const readArtifactFile = vi.fn(async () => new Blob(['x']));
    renderWith(createMockArtifactServer({ listArtifacts: async () => ({ data: sample }), readArtifactFile }));
    fireEvent.click(await screen.findByText('Empty draft'));
    expect(readArtifactFile).not.toHaveBeenCalled();
  });
});

describe('ArtifactsButton', () => {
  it('renders only when the artifacts port exists', () => {
    const withoutPort = renderWith(undefined, <ArtifactsButton compact />);
    expect(screen.queryByRole('button', { name: 'Artifacts' })).not.toBeInTheDocument();
    withoutPort.unmount();

    renderWith(createMockArtifactServer(), <ArtifactsButton compact />);
    expect(screen.getByRole('button', { name: 'Artifacts' })).toBeInTheDocument();
  });
});
