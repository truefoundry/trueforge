// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftComposerLeftSection, DraftComposerRightSection } from '@/atoms/draft/DraftComposerSections.js';
import { CompactLayoutProvider } from '@/atoms/lib/CompactLayoutContext.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import type { AgentSpec } from '@/server/types.js';
import { createMockAgentUIServer } from '../../server/mockServer.js';

let agentSpec: AgentSpec;
const updateAgentSpec = vi.fn();

vi.mock('@truefoundry/trueforge-assistant-ui-runtime', () => ({
  useTrueForgeAgentSpec: () => ({ agentSpec }),
  useTrueForgeUpdateAgentSpec: () => updateAgentSpec,
}));

function DraftSections({
  onAttach,
  disabled = false,
  isRunning = false,
}: {
  onAttach?: () => void;
  disabled?: boolean;
  isRunning?: boolean;
}) {
  const server = createMockAgentUIServer({
    getModels: async () => [
      {
        id: 'gpt-4.1',
        name: 'openai/gpt-4.1',
        provider: { name: 'OpenAI' },
        properties: { reasoningEfforts: ['low', 'high'] },
      },
    ],
  });

  return (
    <ServerProvider server={server}>
      <DraftCatalogProvider>
        <DraftComposerLeftSection disabled={disabled} isRunning={isRunning} onAttach={onAttach} />
        <DraftComposerRightSection disabled={disabled} isRunning={isRunning} />
      </DraftCatalogProvider>
    </ServerProvider>
  );
}

function BuilderMode({ children }: { children: ReactNode }) {
  const { openAgentBuilder } = useShellMode();
  useLayoutEffect(() => {
    openAgentBuilder();
  }, [openAgentBuilder]);
  return children;
}

function AgentConfigState() {
  const { agentConfigOpen } = useShellMode();
  return <span>{agentConfigOpen ? 'Config open' : 'Config closed'}</span>;
}

describe('draft composer sections', () => {
  beforeAll(() => {
    HTMLDialogElement.prototype.showModal = function showModal() {
      this.setAttribute('open', '');
    };
    HTMLDialogElement.prototype.close = function close() {
      this.removeAttribute('open');
      this.dispatchEvent(new Event('close'));
    };
  });

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    agentSpec = {
      model: { name: 'openai/gpt-4.1', params: { reasoningEffort: 'high' } },
      mcpServers: [{ id: 'github', name: 'GitHub' }],
      skills: [
        { id: 'research', name: 'Research' },
        { id: 'writer', name: 'Writer' },
      ],
    };
    updateAgentSpec.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('composes a single plus trigger as the left-side control', () => {
    const onAttach = vi.fn();
    render(<DraftSections onAttach={onAttach} />);

    expect(screen.queryByRole('button', { name: /Tools/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Attach a file' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Files or photos' }));

    expect(onAttach).toHaveBeenCalledTimes(1);
  });

  it('composes the model selector, which owns reasoning effort, in the right section', async () => {
    render(<DraftSections />);

    expect(await screen.findByRole('button', { name: 'Select model' })).toHaveTextContent('gpt-4.1');
    expect(screen.queryByTitle('Select reasoning effort')).not.toBeInTheDocument();
    // Without shell builder mode, left chrome is the plus menu — not Agent config.
    expect(screen.queryByRole('button', { name: 'Agent config' })).not.toBeInTheDocument();
  });

  it('keeps model and reasoning controls out of the builder composer', () => {
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <BuilderMode>
          <DraftSections />
        </BuilderMode>
      </ShellModeProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Select model' })).not.toBeInTheDocument();
    expect(screen.queryByTitle('Select reasoning effort')).not.toBeInTheDocument();
  });

  it('shows the Agent config trigger only in compact builder layouts', () => {
    const onAttach = vi.fn();
    const { rerender } = render(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <BuilderMode>
          <DraftSections />
        </BuilderMode>
      </ShellModeProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Agent config' })).not.toBeInTheDocument();

    rerender(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <BuilderMode>
          <CompactLayoutProvider>
            <DraftSections onAttach={onAttach} />
            <AgentConfigState />
          </CompactLayoutProvider>
        </BuilderMode>
      </ShellModeProvider>,
    );

    expect(screen.queryByRole('button', { name: 'Agent config' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByRole('menuitem', { name: 'Agent config' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Files or photos' }));
    expect(onAttach).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Agent config' }));
    expect(screen.getByText('Config open')).toBeInTheDocument();
  });

  it('shows the same plus button in the builder and attaches directly', () => {
    const onAttach = vi.fn();
    render(
      <ShellModeProvider agentConfig={{ mode: 'AgentComposer' }}>
        <BuilderMode>
          <DraftSections onAttach={onAttach} />
        </BuilderMode>
      </ShellModeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add Files or photos' }));

    expect(onAttach).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('propagates disabled state to composed controls', async () => {
    render(<DraftSections disabled />);

    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(await screen.findByRole('button', { name: 'Select model' })).toBeDisabled();
  });

  it('keeps the plus menu and settings interactive while a chat is running', async () => {
    render(<DraftSections isRunning />);

    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toBeEnabled();
    expect(await screen.findByRole('button', { name: 'Select model' })).toBeEnabled();

    fireEvent.click(add);
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /Connectors/ }), { key: 'ArrowRight' });
    // GitHub is already selected — toggle removes it and flushes after the debounce.
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /GitHub/ }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateAgentSpec).toHaveBeenCalledWith({
      mcpServers: [],
      skills: [
        { id: 'research', name: 'Research' },
        { id: 'writer', name: 'Writer' },
      ],
    });
  });
});
