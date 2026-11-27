// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnalyticsProvider } from '@/analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '@/analytics/events.js';
import type { TrackAnalytics } from '@/analytics/types.js';
import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftCompositeSelector } from '@/atoms/draft/DraftCompositeSelector.js';
import { CompactLayoutProvider } from '@/atoms/lib/CompactLayoutContext.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type {
  AgentBuilderCapabilitiesResponse,
  AgentSkill,
  AgentSpec,
  CatalogServer,
  SandboxCatalogServer,
  SandboxEnvironmentServer,
  SkillCatalogServer,
} from '@/server/types.js';
import {
  createMockAgentUIServer,
  createMockCatalog,
  createMockSandboxEnvironmentServer,
  tenantSessionSharing,
} from '../../server/mockServer.js';
import { allSettingsSections } from '../../server/settingsCapabilityFixture.js';

let agentSpec: AgentSpec;
let draftSessionId: string | undefined;
const updateAgentSpec = vi.fn();
const setSettingsOpen = vi.fn();
const rememberDraftSpec = vi.fn();

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

const setEnvironmentsOpen = vi.fn();

vi.mock('@truefoundry/trueforge-assistant-ui-runtime', () => ({
  useTrueForgeAgentSpec: () => ({ agentSpec, draftSessionId }),
  useTrueForgeUpdateAgentSpec: () => updateAgentSpec,
}));

vi.mock('@/server/ShellModeContext.js', () => ({
  useOptionalShellMode: () => ({ setSettingsOpen, setEnvironmentsOpen, rememberDraftSpec }),
}));

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

function renderSelector({
  onAttach,
  getCapabilities,
  getSkills,
  getMcp,
  catalog = settingsCatalog,
  compact = false,
  environmentServer,
  track,
}: {
  onAttach?: () => void;
  getCapabilities?: () => Promise<AgentBuilderCapabilitiesResponse>;
  getSkills?: () => Promise<AgentSkill[]>;
  getMcp?: () => Promise<{ id: string; name: string; authenticated: boolean }[]>;
  catalog?: CatalogServer | null;
  compact?: boolean;
  environmentServer?: SandboxEnvironmentServer;
  track?: TrackAnalytics;
} = {}) {
  const server = createMockAgentUIServer({
    ...(catalog === null ? {} : { catalog }),
    ...(environmentServer ? { sandboxEnvironments: environmentServer } : {}),
    getCapabilities:
      getCapabilities ??
      (async () => ({
        data: {
          sandbox: { enabled: true, environments: { enabled: true } },
          skill: { enabled: true },
          auto: { status: 'not_configured' },
          sessionSharing: tenantSessionSharing,
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
  const selector = (
    <ServerProvider server={server}>
      <DraftCatalogProvider>
        <DraftCompositeSelector onAttach={onAttach} />
      </DraftCatalogProvider>
    </ServerProvider>
  );
  const laidOut = compact ? <CompactLayoutProvider>{selector}</CompactLayoutProvider> : selector;
  return render(track ? <AnalyticsProvider track={track}>{laidOut}</AnalyticsProvider> : laidOut);
}

function openAddMenu() {
  fireEvent.click(screen.getByRole('button', { name: 'Add' }));
}

// Submenus open on hover/focus in the browser; ArrowRight is the keyboard path the menu itself uses.
function openSubmenu(name: RegExp) {
  fireEvent.keyDown(screen.getByRole('menuitem', { name }), { key: 'ArrowRight' });
}

describe('DraftCompositeSelector', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    draftSessionId = undefined;
    agentSpec = {
      model: { name: 'openai/gpt-4.1' },
      mcpServers: [{ id: 'slack', name: 'Slack' }],
      skills: [{ id: 'research', name: 'Research' }],
    };
    updateAgentSpec.mockReset();
    setSettingsOpen.mockReset();
    setEnvironmentsOpen.mockReset();
    rememberDraftSpec.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the plus trigger with Connectors and Skills rows only for a valid model', () => {
    const view = renderSelector({ onAttach: vi.fn() });
    openAddMenu();
    expect(screen.getByRole('menuitem', { name: 'Add Files or photos' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Connectors/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Skills/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /Capabilities/ })).not.toBeInTheDocument();

    agentSpec = { ...agentSpec, model: { name: '  ' } };
    view.rerender(
      <ServerProvider server={createMockAgentUIServer()}>
        <DraftCatalogProvider>
          <DraftCompositeSelector />
        </DraftCatalogProvider>
      </ServerProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
  });

  it('runs Add Files directly when it is the only menu item', () => {
    agentSpec = { ...agentSpec, model: { name: '  ' } };
    const onAttach = vi.fn();
    renderSelector({ onAttach });

    fireEvent.click(screen.getByRole('button', { name: 'Add Files or photos' }));

    expect(onAttach).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  it('keeps registry skills plain in the draft composer', async () => {
    const loadVersions = vi.fn(async () => []);
    const skill: AgentSkill = Object.assign(
      { id: 'agent-skill:acme/team-a/echo:3', name: 'echo' },
      { version: 3, loadVersions },
    );
    renderSelector({ getSkills: async () => [skill] });

    openAddMenu();
    openSubmenu(/Skills/);

    // Capabilities arrive a tick after the catalog, which replaces the disabled row with an enabled one.
    await waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox', { name: /echo/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole('button', { name: 'Select version for echo' })).not.toBeInTheDocument();
    expect(loadVersions).not.toHaveBeenCalled();
  });

  it('uses contrasting search surfaces in light and dark themes', () => {
    renderSelector();
    openAddMenu();
    openSubmenu(/Connectors/);

    expect(screen.getByPlaceholderText('Search connectors...')).toHaveClass(
      'border-input-border',
      'bg-secondary-bg',
      'dark:bg-primary-bg',
    );
  });

  it('filters the complete connector catalog client-side', async () => {
    renderSelector();
    openAddMenu();
    openSubmenu(/Connectors/);

    expect(await screen.findByRole('menuitemcheckbox', { name: /GitHub/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: /Slack/ })).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText('Search connectors...'), { target: { value: 'git' } });

    expect(screen.getByRole('menuitemcheckbox', { name: /GitHub/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemcheckbox', { name: /Slack/ })).not.toBeInTheDocument();
  });

  it('lists selected connectors under a Selected heading', async () => {
    renderSelector();
    openAddMenu();
    openSubmenu(/Connectors/);

    expect(await screen.findByText('Selected (1)')).toBeInTheDocument();
    expect(screen.getByRole('menuitemcheckbox', { name: /Slack/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('runs the attachment handler from the Add Files or photos item and closes the menu', () => {
    const onAttach = vi.fn();
    renderSelector({ onAttach });
    openAddMenu();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Files or photos' }));

    expect(onAttach).toHaveBeenCalledOnce();
    expect(screen.queryByRole('menuitem', { name: 'Add Files or photos' })).not.toBeInTheDocument();
  });

  it('drills into connectors inside the compact sheet and back out again', async () => {
    renderSelector({ onAttach: vi.fn(), compact: true });

    openAddMenu();
    expect(screen.getByRole('dialog', { name: 'Add to composer' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('menuitem', { name: /Connectors/ }));

    expect(await screen.findByRole('menuitemcheckbox', { name: /GitHub/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Add Files or photos' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitem', { name: 'Back' }));
    expect(screen.getByRole('menuitem', { name: 'Add Files or photos' })).toBeInTheDocument();
  });

  it('debounces connector changes into one draft update', async () => {
    renderSelector();
    openAddMenu();
    openSubmenu(/Connectors/);
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
    openAddMenu();
    openSubmenu(/Connectors/);

    fireEvent.click(await screen.findByRole('button', { name: /Please configure Connectors in the settings/ }));

    expect(setSettingsOpen).toHaveBeenCalledWith(true, 'connectors');
    expect(screen.queryByRole('menuitem', { name: /Connectors/ })).not.toBeInTheDocument();
  });

  it('opens settings from the empty skills state', async () => {
    renderSelector({ getSkills: async () => [] });
    openAddMenu();
    openSubmenu(/Skills/);

    fireEvent.click(await screen.findByRole('button', { name: /Please configure Skills in the settings/ }));

    expect(setSettingsOpen).toHaveBeenCalledWith(true, 'skills');
  });

  it('explains the sandbox requirement when skills are unavailable', async () => {
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: false, environments: { enabled: false } },
          skill: { enabled: false, reason: 'Skills run in a sandbox, which is not configured.' },
          auto: { status: 'not_configured' },
          sessionSharing: tenantSessionSharing,
        },
      }),
      getSkills: async () => [],
    });
    openAddMenu();
    openSubmenu(/Skills/);

    expect(await screen.findByRole('status')).toHaveTextContent('Skills run in a sandbox, which is not configured.');
    const emptyState = screen.getByRole('button', { name: /Please configure a Sandbox in the settings/ });
    fireEvent.click(emptyState);

    expect(setSettingsOpen).toHaveBeenCalledWith(true, 'sandbox');
  });

  it('opens skills settings when skills are empty and a sandbox is already configured', async () => {
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true, environments: { enabled: true } },
          skill: { enabled: false, reason: 'Skills are not available.' },
          auto: { status: 'not_configured' },
          sessionSharing: tenantSessionSharing,
        },
      }),
      getSkills: async () => [],
    });
    openAddMenu();
    openSubmenu(/Skills/);

    fireEvent.click(await screen.findByRole('button', { name: /Please configure Skills in the settings/ }));

    expect(setSettingsOpen).toHaveBeenCalledWith(true, 'skills');
  });

  it('does not offer connector settings without a settings catalog', async () => {
    renderSelector({ getMcp: async () => [], catalog: null });
    openAddMenu();
    openSubmenu(/Connectors/);

    expect(await screen.findByText('No connectors')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Please configure Connectors/ })).not.toBeInTheDocument();
  });

  it('does not offer connector settings when settings are disabled', async () => {
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true, environments: { enabled: true } },
          skill: { enabled: true },
          auto: { status: 'not_configured' },
          sessionSharing: tenantSessionSharing,
          settings: allSettingsSections(false),
        },
      }),
      getMcp: async () => [],
    });
    openAddMenu();
    openSubmenu(/Connectors/);

    expect(await screen.findByText('No connectors')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Please configure Connectors/ })).not.toBeInTheDocument();
  });

  it('does not offer skills settings when the skills settings section is unavailable', async () => {
    renderSelector({ getSkills: async () => [], catalog: createMockCatalog() });
    openAddMenu();
    openSubmenu(/Skills/);

    expect(await screen.findByText('No skills')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Please configure Skills/ })).not.toBeInTheDocument();
  });

  it('does not offer sandbox settings when the sandbox settings section is unavailable', async () => {
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: false, environments: { enabled: false } },
          skill: { enabled: false, reason: 'Skills run in a sandbox, which is not configured.' },
          auto: { status: 'not_configured' },
          sessionSharing: tenantSessionSharing,
        },
      }),
      getSkills: async () => [],
      catalog: createMockCatalog({ skillCatalog }),
    });
    openAddMenu();
    openSubmenu(/Skills/);

    expect(await screen.findByText('No skills')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Please configure a Sandbox/ })).not.toBeInTheDocument();
  });

  it('renders every environment, greying out pending/failed ones, with no status badges', async () => {
    const environmentServer = createMockSandboxEnvironmentServer({
      listEnvironments: async () => ({
        data: [
          {
            id: 'env-default',
            name: 'trueforge-sandbox-env',
            description: 'Default environment',
            status: 'ready',
            enabled: true,
            isDefault: true,
            statusReason: null,
            manifest: { name: 'trueforge-sandbox-env', description: 'Default environment' },
            createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
            createdAt: '2026-09-01T10:00:00Z',
            updatedAt: '2026-09-01T10:00:00Z',
          },
          {
            id: 'env-1',
            name: 'python-dev',
            description: 'Python 3.11 environment with poetry',
            status: 'ready',
            enabled: true,
            isDefault: false,
            statusReason: null,
            manifest: { name: 'python-dev', description: 'Python 3.11 environment with poetry' },
            createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
            createdAt: '2026-09-01T10:00:00Z',
            updatedAt: '2026-09-01T10:00:00Z',
          },
          {
            id: 'env-2',
            name: 'building-env',
            description: '',
            status: 'pending',
            enabled: true,
            isDefault: false,
            statusReason: null,
            manifest: { name: 'building-env' },
            createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
            createdAt: '2026-09-01T10:00:00Z',
            updatedAt: '2026-09-01T10:00:00Z',
          },
          {
            id: 'env-3',
            name: 'broken-env',
            description: '',
            status: 'failed',
            enabled: true,
            isDefault: false,
            statusReason: 'Build failed',
            manifest: { name: 'broken-env' },
            createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
            createdAt: '2026-09-01T10:00:00Z',
            updatedAt: '2026-09-01T10:00:00Z',
          },
        ],
      }),
    });

    renderSelector({ environmentServer });
    openAddMenu();
    // Environment is gated on capabilities, which resolve after the first render.
    await screen.findByRole('menuitem', { name: /Environment/ });
    openSubmenu(/Environment/);

    expect(await screen.findByText('trueforge-sandbox-env')).toBeInTheDocument();
    expect(screen.getByText('Default environment')).toBeInTheDocument();
    expect(await screen.findByText('python-dev')).toBeInTheDocument();
    expect(screen.getByText('Python 3.11 environment with poetry')).toBeInTheDocument();

    // Pending and failed environments are listed, but cannot be picked
    const building = screen.getByRole('radio', { name: 'Select building-env' });
    expect(building).toBeDisabled();
    fireEvent.mouseEnter(building.parentElement ?? building);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Still building');
    fireEvent.mouseLeave(building.parentElement ?? building);
    expect(screen.getByRole('radio', { name: 'Select broken-env' })).toBeDisabled();

    // No "Ready" status badge should be rendered
    expect(screen.queryByText('Ready')).not.toBeInTheDocument();

    // Select custom environment
    fireEvent.click(screen.getByText('python-dev'));
    expect(updateAgentSpec).toHaveBeenCalledWith({
      config: expect.objectContaining({
        sandbox: expect.objectContaining({
          enabled: true,
          environmentName: 'python-dev',
        }),
      }),
    });

    // The tenant default is listed under its own name and pins like any other
    fireEvent.click(screen.getByText('trueforge-sandbox-env'));
    expect(updateAgentSpec).toHaveBeenCalledWith({
      config: expect.objectContaining({
        sandbox: expect.objectContaining({
          environmentName: 'trueforge-sandbox-env',
        }),
      }),
    });
  });

  it('locks environment selection once a chat session exists', async () => {
    draftSessionId = 'session-1';
    agentSpec = {
      ...agentSpec,
      config: { sandbox: { enabled: true, environmentName: 'python-dev' } },
    };
    const environmentServer = createMockSandboxEnvironmentServer({
      listEnvironments: async () => ({
        data: [
          {
            id: 'env-default',
            name: 'trueforge-sandbox-env',
            description: 'Default environment',
            status: 'ready',
            enabled: true,
            isDefault: true,
            statusReason: null,
            manifest: { name: 'trueforge-sandbox-env', description: 'Default environment' },
            createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
            createdAt: '2026-09-01T10:00:00Z',
            updatedAt: '2026-09-01T10:00:00Z',
          },
          {
            id: 'env-1',
            name: 'python-dev',
            description: 'Python 3.11 environment',
            status: 'ready',
            enabled: true,
            isDefault: false,
            statusReason: null,
            manifest: { name: 'python-dev', description: 'Python 3.11 environment' },
            createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
            createdAt: '2026-09-01T10:00:00Z',
            updatedAt: '2026-09-01T10:00:00Z',
          },
        ],
      }),
    });

    renderSelector({ environmentServer });
    openAddMenu();
    // Environment is gated on capabilities, which resolve after the first render.
    await screen.findByRole('menuitem', { name: /Environment/ });
    openSubmenu(/Environment/);

    expect(await screen.findByText("Can't change the environment after a chat has started")).toBeInTheDocument();
    fireEvent.click(screen.getByText('trueforge-sandbox-env'));
    expect(updateAgentSpec).not.toHaveBeenCalled();
  });

  it('says no environments exist instead of offering Default when none are ready', async () => {
    const environmentServer = createMockSandboxEnvironmentServer({
      listEnvironments: async () => ({ data: [] }),
    });

    renderSelector({ environmentServer });
    openAddMenu();
    // Environment is gated on capabilities, which resolve after the first render.
    await screen.findByRole('menuitem', { name: /Environment/ });
    openSubmenu(/Environment/);

    expect(await screen.findByRole('button', { name: /Please configure Environments/ })).toBeInTheDocument();
    expect(screen.queryByRole('menuitemradio')).not.toBeInTheDocument();
  });

  it('shows a deleted environment from the agent spec and does not change it', async () => {
    agentSpec = {
      ...agentSpec,
      config: { sandbox: { enabled: true, environmentName: 'gone-env' } },
    };
    const environmentServer = createMockSandboxEnvironmentServer({
      listEnvironments: async () => ({
        data: [
          {
            id: 'env-default',
            name: 'trueforge-sandbox-env',
            description: 'Default environment',
            status: 'ready',
            enabled: true,
            isDefault: true,
            statusReason: null,
            manifest: { name: 'trueforge-sandbox-env', description: 'Default environment' },
            createdBySubject: { subjectId: 'u1', subjectType: 'user', subjectDisplayName: 'user-1' },
            createdAt: '2026-09-01T10:00:00Z',
            updatedAt: '2026-09-01T10:00:00Z',
          },
        ],
      }),
    });

    renderSelector({ environmentServer });
    openAddMenu();
    // Environment is gated on capabilities, which resolve after the first render.
    await screen.findByRole('menuitem', { name: /Environment/ });
    openSubmenu(/Environment/);

    expect(await screen.findByText('gone-env')).toBeInTheDocument();
    expect(screen.queryByText('This environment is no longer available')).not.toBeInTheDocument();
    const goneRow = screen.getByRole('menuitemradio', { name: /gone-env/ });
    expect(goneRow).toHaveAttribute('aria-checked', 'true');
    expect(goneRow).toHaveAttribute('aria-disabled', 'true');

    fireEvent.click(screen.getByText('gone-env'));
    expect(updateAgentSpec).not.toHaveBeenCalled();
  });

  it('shows Web search under Built-in and toggles draft config when available', async () => {
    agentSpec = {
      ...agentSpec,
      config: { webSearch: { enabled: true } },
    };
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true, environments: { enabled: true } },
          skill: { enabled: true },
          auto: { status: 'not_configured' },
          sessionSharing: tenantSessionSharing,
          webSearch: { enabled: true },
        },
      }),
    });

    openAddMenu();
    openSubmenu(/Connectors/);
    expect(screen.getByText('Built-in')).toBeInTheDocument();
    await waitFor(() => {
      const row = screen.getByRole('menuitemcheckbox', { name: /Web search/ });
      expect(row).toBeEnabled();
      expect(row).toHaveAttribute('aria-checked', 'true');
    });

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Web search/ }));
    expect(updateAgentSpec).toHaveBeenCalledWith({
      config: { webSearch: { enabled: false } },
    });
    expect(rememberDraftSpec).toHaveBeenCalledWith(
      {
        ...agentSpec,
        config: { webSearch: { enabled: false } },
      },
      'chat',
    );
  });

  it('enables TrueForge under Built-in by default and lets the user turn it off', () => {
    renderSelector();
    openAddMenu();
    openSubmenu(/Connectors/);
    const row = screen.getByRole('menuitemcheckbox', { name: /TrueForge/ });
    expect(row).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(row);
    expect(updateAgentSpec).toHaveBeenCalledWith({
      config: { trueforge: { enabled: false } },
    });
    expect(rememberDraftSpec).toHaveBeenCalledWith(
      {
        ...agentSpec,
        config: { trueforge: { enabled: false } },
      },
      'chat',
    );
  });

  it('keeps Web search disabled with a tooltip when the capability is off', async () => {
    agentSpec = {
      ...agentSpec,
      config: { webSearch: { enabled: false } },
    };
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true, environments: { enabled: true } },
          skill: { enabled: true },
          auto: { status: 'not_configured' },
          sessionSharing: tenantSessionSharing,
          webSearch: { enabled: false },
        },
      }),
    });

    openAddMenu();
    openSubmenu(/Connectors/);
    await waitFor(() => {
      const row = screen.getByRole('menuitemcheckbox', { name: /Web search/ });
      expect(row).toHaveAttribute('aria-disabled', 'true');
      expect(row).toHaveAttribute('aria-checked', 'false');
    });

    const checkbox = screen.getByRole('checkbox', { name: /Select Web search/ });
    expect(checkbox).toBeDisabled();
    fireEvent.mouseEnter(checkbox.parentElement!);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('Web search is not configured');

    fireEvent.mouseLeave(checkbox.parentElement!);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByRole('menuitemcheckbox', { name: /Web search/ }));
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    fireEvent.click(checkbox);
    expect(updateAgentSpec).not.toHaveBeenCalled();
  });

  it('explains why web search is unavailable using the host reason', async () => {
    agentSpec = {
      ...agentSpec,
      config: { webSearch: { enabled: false } },
    };
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true },
          skill: { enabled: true },
          auto: { status: 'not_configured' },
          sessionSharing: tenantSessionSharing,
          webSearch: { enabled: false, reason: 'Web search is turned off for this tenant.' },
        },
      }),
    });

    openAddMenu();
    openSubmenu(/Connectors/);
    // The row renders locked with a generic hint until capabilities land, so wait for the reason.
    const note = await screen.findByText('Web search is turned off for this tenant.');
    expect(note.closest('[role="status"]')).not.toBeNull();
  });

  it('lets a chat that already searches the web turn it off after the capability goes away', async () => {
    agentSpec = {
      ...agentSpec,
      config: { webSearch: { enabled: true } },
    };
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true },
          skill: { enabled: true },
          auto: { status: 'not_configured' },
          sessionSharing: tenantSessionSharing,
          webSearch: { enabled: false },
        },
      }),
    });

    openAddMenu();
    openSubmenu(/Connectors/);
    await waitFor(() => {
      const row = screen.getByRole('menuitemcheckbox', { name: /Web search/ });
      expect(row).toHaveAttribute('aria-checked', 'true');
      expect(row).not.toHaveAttribute('aria-disabled', 'true');
    });

    // Turning it off is the last chance, so the row has to say so before the click.
    expect(await screen.findByText(/Turning it off here is final/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: /Web search/ }));
    expect(updateAgentSpec).toHaveBeenCalledWith({ config: { webSearch: { enabled: false } } });
  });

  it('does not caution a chat the host still allows', async () => {
    agentSpec = {
      ...agentSpec,
      config: { webSearch: { enabled: true } },
    };
    renderSelector({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true },
          skill: { enabled: true },
          auto: { status: 'not_configured' },
          sessionSharing: tenantSessionSharing,
          webSearch: { enabled: true },
        },
      }),
    });

    openAddMenu();
    openSubmenu(/Connectors/);
    await waitFor(() => {
      expect(screen.getByRole('menuitemcheckbox', { name: /Web search/ })).toHaveAttribute('aria-checked', 'true');
    });
    expect(screen.queryByText(/Turning it off here is final/)).not.toBeInTheDocument();
  });

  it('shows selected connectors and a skill count beside the plus button', () => {
    agentSpec = {
      ...agentSpec,
      mcpServers: [
        { id: 'slack', name: 'Slack' },
        { id: 'github', name: 'GitHub' },
        { id: 'jira', name: 'Jira' },
        { id: 'notion', name: 'Notion' },
        { id: 'linear', name: 'Linear' },
      ],
      skills: [
        { id: 'research', name: 'Research' },
        { id: 'writing', name: 'Writing' },
      ],
    };
    renderSelector();

    expect(screen.getByRole('img', { name: 'Slack' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'GitHub' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Jira' })).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Notion' })).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2 more connectors' })).toBeInTheDocument();
    expect(screen.getByText('2 Skills')).toBeInTheDocument();
  });

  it('shows no selection chips when nothing is selected', () => {
    agentSpec = { ...agentSpec, mcpServers: [], skills: [] };
    renderSelector();

    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.queryByText(/Skills?$/)).not.toBeInTheDocument();
  });

  it('tracks opening the plus menu and choosing an item', () => {
    const track = vi.fn();
    const onAttach = vi.fn();
    renderSelector({ onAttach, track });

    openAddMenu();
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Composer.ADD_MENU_OPENED, undefined);

    fireEvent.click(screen.getByRole('menuitem', { name: /Add Files or photos/ }));
    expect(onAttach).toHaveBeenCalledOnce();
    expect(track).toHaveBeenCalledWith(AnalyticsEvents.Composer.ADD_MENU_ITEM_SELECTED, { item: 'attach' });
  });
});
