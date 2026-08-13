// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftCompositeSelector } from '@/atoms/draft/DraftCompositeSelector.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentSpec } from '@/server/types.js';
import { createMockAgentUIServer } from '../../server/mockServer.js';

let agentSpec: AgentSpec;
const updateAgentSpec = vi.fn();
const setSettingsOpen = vi.fn();

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  useTrueFoundryAgentSpec: () => ({ agentSpec }),
  useTrueFoundryUpdateAgentSpec: () => updateAgentSpec,
}));

vi.mock('@/server/ShellModeContext.js', () => ({
  useOptionalShellMode: () => ({ setSettingsOpen }),
}));

function renderSelector({
  onAttach,
  getCapabilities,
  getSkills,
  getMcp,
}: {
  onAttach?: () => void;
  getCapabilities?: () => Promise<{
    data: { sandbox: { enabled: boolean }; skill: { enabled: boolean; reason?: string } };
  }>;
  getSkills?: () => Promise<{ id: string; name: string }[]>;
  getMcp?: () => Promise<{ id: string; name: string; authenticated: boolean }[]>;
} = {}) {
  const server = createMockAgentUIServer({
    getCapabilities:
      getCapabilities ??
      (async () => ({
        data: {
          sandbox: { enabled: true },
          skill: { enabled: true },
        },
      })),
    getModels: async () => [],
    getSkills: getSkills ?? (async () => [{ id: 'research', name: 'Research' }]),
    getMcp:
      getMcp ??
      (async () => [
        { id: 'github', name: 'GitHub', authenticated: true },
        { id: 'slack', name: 'Slack', authenticated: true },
      ]),
  });
  return render(
    <ServerProvider server={server}>
      <DraftCatalogProvider>
        <DraftCompositeSelector onAttach={onAttach} />
      </DraftCatalogProvider>
    </ServerProvider>,
  );
}

describe('DraftCompositeSelector', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    agentSpec = {
      model: { name: 'openai/gpt-4.1' },
      mcpServers: [{ id: 'slack', name: 'Slack' }],
      skills: [{ id: 'research', name: 'Research' }],
    };
    updateAgentSpec.mockReset();
    setSettingsOpen.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows one combined Tools count only for a valid model', () => {
    const view = renderSelector();
    expect(screen.getByRole('button', { name: 'Tools (2)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));
    expect(screen.getByRole('dialog', { name: 'Add to composer' })).toBeInTheDocument();

    agentSpec = { ...agentSpec, model: { name: '  ' } };
    view.rerender(
      <ServerProvider server={createMockAgentUIServer()}>
        <DraftCatalogProvider>
          <DraftCompositeSelector />
        </DraftCatalogProvider>
      </ServerProvider>,
    );
    expect(screen.queryByRole('button', { name: /Tools/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Add to composer' })).not.toBeInTheDocument();
  });

  it('uses contrasting search surfaces in light and dark themes', () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));

    expect(screen.getByPlaceholderText('Search connectors...')).toHaveClass(
      'border-input-border',
      'bg-secondary-bg',
      'dark:bg-primary-bg',
    );
  });

  it('renders attachment as a standalone tooltip control', () => {
    const onAttach = vi.fn();
    renderSelector({ onAttach });

    const attach = screen.getByRole('button', { name: 'Attach a file' });
    fireEvent.mouseEnter(attach);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Attach a file');
    fireEvent.click(attach);
    expect(onAttach).toHaveBeenCalledOnce();
    expect(screen.queryByRole('dialog', { name: 'Add to composer' })).not.toBeInTheDocument();
  });

  it('debounces connector changes into one draft update', async () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /GitHub/ }));

    expect(updateAgentSpec).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(updateAgentSpec).toHaveBeenCalledWith({
      mcpServers: [
        { id: 'slack', name: 'Slack' },
        { id: 'github', name: 'GitHub' },
      ],
      skills: [{ id: 'research', name: 'Research' }],
    });
  });

  it('treats omitted capabilities as enabled and patches only capability branches', async () => {
    agentSpec = { ...agentSpec, config: {} };
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));
    fireEvent.click(screen.getByRole('button', { name: /Capabilities/ }));

    const generativeUi = screen.getByRole('switch', { name: 'Generative UI' });
    expect(generativeUi).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(generativeUi);

    expect(updateAgentSpec).toHaveBeenCalledWith({
      config: {
        generativeUi: { enabled: false },
        dynamicSubAgents: { enabled: true },
        askUserQuestions: { enabled: true },
      },
    });
  });

  it('folds dirty connector toggles into a capability update', async () => {
    renderSelector();
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));
    fireEvent.click(await screen.findByRole('menuitemcheckbox', { name: /GitHub/ }));
    fireEvent.click(screen.getByRole('button', { name: /Capabilities/ }));
    fireEvent.click(screen.getByRole('switch', { name: 'Generative UI' }));

    expect(updateAgentSpec).toHaveBeenCalledTimes(1);
    expect(updateAgentSpec).toHaveBeenCalledWith({
      mcpServers: [
        { id: 'slack', name: 'Slack' },
        { id: 'github', name: 'GitHub' },
      ],
      skills: [{ id: 'research', name: 'Research' }],
      config: {
        generativeUi: { enabled: false },
        dynamicSubAgents: { enabled: true },
        askUserQuestions: { enabled: true },
      },
    });
  });

  it('opens settings from the empty connectors state', async () => {
    renderSelector({ getMcp: async () => [] });
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));

    fireEvent.click(await screen.findByRole('button', { name: /Please configure Connectors in the settings/ }));

    expect(setSettingsOpen).toHaveBeenCalledWith(true, 'connectors');
    expect(screen.queryByRole('dialog', { name: 'Add to composer' })).not.toBeInTheDocument();
  });

  it('opens settings from the empty skills state', async () => {
    renderSelector({ getSkills: async () => [] });
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));
    fireEvent.click(screen.getByRole('button', { name: /Skills/ }));

    fireEvent.click(await screen.findByRole('button', { name: /Please configure Skills in the settings/ }));

    expect(setSettingsOpen).toHaveBeenCalledWith(true, 'skills');
  });

  it('explains the sandbox requirement when skills are unavailable', async () => {
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: false },
          skill: { enabled: false, reason: 'Skills run in a sandbox, which is not configured.' },
        },
      }),
      getSkills: async () => [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));
    fireEvent.click(screen.getByRole('button', { name: /Skills/ }));

    expect(await screen.findByRole('status')).toHaveTextContent('Skills run in a sandbox, which is not configured.');
    const emptyState = screen.getByRole('button', { name: /Please configure a Sandbox in the settings/ });
    fireEvent.click(emptyState);

    expect(setSettingsOpen).toHaveBeenCalledWith(true, 'sandbox');
  });

  it('opens skills settings when skills are empty and a sandbox is already configured', async () => {
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true },
          skill: { enabled: false, reason: 'Skills are not available.' },
        },
      }),
      getSkills: async () => [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));
    fireEvent.click(screen.getByRole('button', { name: /Skills/ }));

    fireEvent.click(await screen.findByRole('button', { name: /Please configure Skills in the settings/ }));

    expect(setSettingsOpen).toHaveBeenCalledWith(true, 'skills');
  });
});
