// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftCompositeSelector } from '@/atoms/draft/DraftCompositeSelector.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentSpec, CatalogServer, SandboxCatalogServer, SkillCatalogServer } from '@/server/types.js';
import { createMockAgentUIServer, createMockCatalog } from '../../server/mockServer.js';

let agentSpec: AgentSpec;
const updateAgentSpec = vi.fn();
const setSettingsOpen = vi.fn();

async function unavailable(): Promise<never> {
  throw new Error('Unexpected settings catalog call');
}

const skillCatalog: SkillCatalogServer = {
  getSkillCatalog: async () => [],
  listSkills: async () => [],
  createSkill: unavailable,
};

const sandboxCatalog: SandboxCatalogServer = {
  getSandboxProviderCatalog: async () => [],
  listSandboxProviders: async () => [],
  createSandboxProvider: unavailable,
  updateSandboxProvider: unavailable,
};

const settingsCatalog = createMockCatalog({ skillCatalog, sandboxCatalog });

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
  catalog = settingsCatalog,
}: {
  onAttach?: () => void;
  getCapabilities?: () => Promise<{
    data: {
      sandbox: { enabled: boolean };
      skill: { enabled: boolean; reason?: string };
      settings?: { enabled: boolean };
    };
  }>;
  getSkills?: () => Promise<{ id: string; name: string }[]>;
  getMcp?: () => Promise<{ id: string; name: string; authenticated: boolean }[]>;
  catalog?: CatalogServer | null;
} = {}) {
  const server = createMockAgentUIServer({
    ...(catalog === null ? {} : { catalog }),
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
    expect(screen.getByRole('button', { name: /Connectors/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Skills/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Capabilities/ })).not.toBeInTheDocument();

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
  it('shows selected connectors and skills in the Tools tooltip', () => {
    renderSelector();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Tools (2)' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Connectors: Slack');
    expect(screen.getByRole('tooltip')).toHaveTextContent('Skills: Research');
  });

  it('truncates Tools tooltip names after 4 with a remainder count', () => {
    agentSpec = {
      ...agentSpec,
      mcpServers: [
        { id: 'a', name: 'Alpha' },
        { id: 'b', name: 'Beta' },
        { id: 'c', name: 'Gamma' },
        { id: 'd', name: 'Delta' },
        { id: 'e', name: 'Epsilon' },
        { id: 'f', name: 'Zeta' },
      ],
      skills: [],
    };
    renderSelector();
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'Tools (6)' }));
    expect(screen.getByRole('tooltip')).toHaveTextContent('Connectors: Alpha, Beta, Gamma, Delta +2');
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

  it('does not offer connector settings without a settings catalog', async () => {
    renderSelector({ getMcp: async () => [], catalog: null });
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));

    expect(await screen.findByText('No connectors')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Please configure Connectors/ })).not.toBeInTheDocument();
  });

  it('does not offer connector settings when settings are disabled', async () => {
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true },
          skill: { enabled: true },
          settings: { enabled: false },
        },
      }),
      getMcp: async () => [],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));

    expect(await screen.findByText('No connectors')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Please configure Connectors/ })).not.toBeInTheDocument();
  });

  it('does not offer skills settings when the skills settings section is unavailable', async () => {
    renderSelector({ getSkills: async () => [], catalog: createMockCatalog() });
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));
    fireEvent.click(screen.getByRole('button', { name: /Skills/ }));

    expect(await screen.findByText('No skills')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Please configure Skills/ })).not.toBeInTheDocument();
  });

  it('does not offer sandbox settings when the sandbox settings section is unavailable', async () => {
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: false },
          skill: { enabled: false, reason: 'Skills run in a sandbox, which is not configured.' },
        },
      }),
      getSkills: async () => [],
      catalog: createMockCatalog({ skillCatalog }),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Tools (2)' }));
    fireEvent.click(screen.getByRole('button', { name: /Skills/ }));

    expect(await screen.findByText('No skills')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Please configure a Sandbox/ })).not.toBeInTheDocument();
  });
});
