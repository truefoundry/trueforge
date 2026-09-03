// @vitest-environment jsdom
import type { CatalogServer } from '@/server/types.js';
import { useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createMockAgentUIServer, createMockCatalog } from '../server/mockServer.js';

vi.mock('@truefoundry/assistant-ui-runtime', () => ({
  trueFoundryAttachmentAdapter: {},
  useTrueFoundryAgentRuntime: () =>
    useExternalStoreRuntime<ThreadMessageLike>({
      messages: [],
      isRunning: false,
      convertMessage: (message: ThreadMessageLike) => message,
      onNew: async () => {},
    }),
  useTrueFoundryCancel: () => vi.fn(),
  useTrueFoundryToolResponses: () => ({ pending: [] }),
  useTrueFoundryRespondToToolApproval: () => vi.fn(),
  useTrueFoundryMcpAuth: () => ({ pending: [], connect: vi.fn(), continue: vi.fn() }),
  useTrueFoundryHistoryPagination: () => ({
    isLoadingMore: false,
    hasMore: false,
    loadMore: vi.fn(),
  }),
  useTrueFoundryAgentSpec: () => ({
    agentSpec: { model: { name: 'openai-main/gpt-4.1' } },
  }),
  useTrueFoundryFlushAgentSpec: () => async () => {},
  useTrueFoundryAdoptAgentSpec: () => vi.fn(),
  useTrueFoundryUpdateAgentSpec: () => vi.fn(),
}));

vi.mock('@truefoundry/assistant-ui-runtime/plugins/truefoundry-agent-server-adapter', () => ({
  createTrueFoundryAgentUIServer: vi.fn(
    () =>
      new Promise(() => {
        /* never resolves — keep init loader visible */
      }),
  ),
}));

vi.mock('@/plugins/trueforge-agent-server-adapter/index.js', () => ({
  createTrueForgeAgentUIServer: vi.fn(async () =>
    createMockAgentUIServer({
      getCapabilities: async () => ({
        data: {
          sandbox: { enabled: true },
          skill: { enabled: true },
          settings: { enabled: true },
        },
      }),
    }),
  ),
}));

import { TrueForgeUI, type ChatLayout } from '@/containers/TrueForgeUI.js';
import { DrawerLayout } from '@/layouts/DrawerLayout.js';
import { SidebarLayout } from '@/layouts/SidebarLayout.js';
import { StackChatPanel } from '@/layouts/StackChatPanel.js';
import { WidgetLayout } from '@/layouts/WidgetLayout.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider, useShellMode } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { RuntimeHarness } from './RuntimeHarness.js';

function mockServer(catalog?: CatalogServer) {
  return createMockAgentUIServer(catalog === undefined ? {} : { catalog });
}

/** Minimal catalog stub — ShellActions only checks presence. */
const stubCatalog = createMockCatalog();

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal() {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close() {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});

describe('TrueForgeUI', () => {
  const server = mockServer();
  const layouts: ChatLayout[] = ['sidebar', 'drawer', 'dock', 'widget'];

  it.each(layouts)('mounts layout=%s without crashing', async layout => {
    const { container } = render(
      <TrueForgeUI
        server={server}
        agentConfig={{ mode: 'SingleAgent', name: 'my-agent' }}
        layout={layout}
        className="h-96"
      />,
    );
    await act(async () => {
      await vi.dynamicImportSettled();
    });
    await waitFor(() => {
      switch (layout) {
        case 'sidebar':
          expect(screen.getByRole('button', { name: 'Start new chat' })).toBeInTheDocument();
          expect(screen.queryByRole('button', { name: /^(Collapse|Expand) sidebar$/ })).not.toBeInTheDocument();
          break;
        case 'drawer':
          expect(screen.getByRole('button', { name: 'New Chat' })).toBeInTheDocument();
          // SingleAgent has no composer — New Agent is composer-only.
          expect(screen.queryByRole('button', { name: 'New Agent' })).not.toBeInTheDocument();
          break;
        case 'dock':
          expect(container.querySelector('[data-aui-compact-layout]')).toBeInTheDocument();
          break;
        case 'widget':
          expect(screen.getByRole('button', { name: 'Open chat' })).toBeInTheDocument();
          break;
      }
    });
    expect(container.querySelector('.h-96')).toBeInTheDocument();
  });

  it('mounts a custom layout component inside providers', async () => {
    function CustomLayout({ className }: { className?: string }) {
      return (
        <div data-testid="custom-layout" className={className}>
          custom chrome
        </div>
      );
    }

    render(
      <TrueForgeUI
        server={server}
        agentConfig={{ mode: 'SingleAgent', name: 'my-agent' }}
        layout={CustomLayout}
        className="h-96"
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('custom-layout')).toHaveTextContent('custom chrome');
    });
  });

  it('refetches composer data when starting a new chat', async () => {
    const getCapabilities = vi
      .fn()
      .mockResolvedValueOnce({ data: { sandbox: { enabled: true }, skill: { enabled: true } } })
      .mockResolvedValueOnce({
        data: {
          sandbox: { enabled: false },
          skill: { enabled: false, reason: 'Select Sandbox first' },
        },
      });
    const getModels = vi.fn(async () => []);
    const getSkills = vi.fn(async () => []);
    const getMcp = vi.fn(async () => []);

    render(
      <TrueForgeUI
        server={createMockAgentUIServer({ getCapabilities, getModels, getSkills, getMcp })}
        agentConfig={{ mode: 'AgentComposer' }}
        layout="sidebar"
      />,
    );

    await waitFor(() => {
      expect(getCapabilities).toHaveBeenCalledTimes(1);
      expect(getModels).toHaveBeenCalledTimes(1);
      expect(getSkills).toHaveBeenCalledTimes(1);
      expect(getMcp).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Start new chat' }));

    await waitFor(() => {
      expect(getCapabilities).toHaveBeenCalledTimes(2);
      expect(getModels).toHaveBeenCalledTimes(2);
      expect(getSkills).toHaveBeenCalledTimes(2);
      expect(getMcp).toHaveBeenCalledTimes(2);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Tools (0)' }));
    fireEvent.click(screen.getByRole('button', { name: /Skills/ }));
    expect(await screen.findByRole('status')).toHaveTextContent('Select Sandbox first');
  });

  it('shares catalog data with the Save Agent stacked editors', async () => {
    const getModels = vi.fn(async () => [
      {
        id: 'openai-main/gpt-4.1',
        name: 'openai-main/gpt-4.1',
        provider: { name: 'OpenAI' },
        properties: {},
      },
    ]);
    const getMcp = vi.fn(async () => [{ id: 'github', name: 'GitHub', authenticated: true }]);
    const getSkills = vi.fn(async () => [{ id: 'research', name: 'Research' }]);

    render(
      <TrueForgeUI
        server={createMockAgentUIServer({ getModels, getMcp, getSkills })}
        agentConfig={{ mode: 'AgentComposer' }}
        layout="sidebar"
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Start new agent' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save Agent' }));
    const saveDialog = await screen.findByRole('dialog', { name: 'Save agent' });
    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Edit Model' }));

    const modelDialog = document.querySelector('dialog[aria-label="Edit model"]');
    if (!(modelDialog instanceof HTMLDialogElement)) throw new Error('expected stacked model dialog');
    expect(await within(modelDialog).findByRole('option', { name: /gpt-4.1/ })).toBeInTheDocument();
    fireEvent.click(within(modelDialog).getByRole('button', { name: 'Close' }));

    fireEvent.click(within(saveDialog).getByRole('button', { name: 'Edit Connectors' }));
    const mcpDialog = document.querySelector('dialog[aria-label="Edit Connectors"]');
    if (!(mcpDialog instanceof HTMLDialogElement)) throw new Error('expected stacked MCP dialog');
    expect(await within(mcpDialog).findByText('GitHub')).toBeInTheDocument();
    expect(getModels).toHaveBeenCalled();
    expect(getMcp).toHaveBeenCalled();
    expect(getSkills).toHaveBeenCalled();
  });

  it('renders only the MCP authorization screen when requested by the URL', async () => {
    const originalUrl = window.location.href;
    const postMessage = vi.fn();
    const close = vi.fn();
    vi.stubGlobal(
      'BroadcastChannel',
      class {
        postMessage = postMessage;
        close = close;
      },
    );
    window.history.replaceState(null, '', '/?screenType=mcp-auth&pUid=popup-1&isSuccess=true');

    let unmount: (() => void) | undefined;
    try {
      const view = render(
        <TrueForgeUI
          server={server}
          agentConfig={{ mode: 'SingleAgent', name: 'my-agent' }}
          layout={() => <div data-testid="regular-layout">regular chrome</div>}
        />,
      );
      unmount = view.unmount;

      expect(await screen.findByText('Authorization successful')).toBeInTheDocument();
      expect(screen.queryByTestId('regular-layout')).not.toBeInTheDocument();
    } finally {
      unmount?.();
      window.history.replaceState(null, '', originalUrl);
      vi.unstubAllGlobals();
    }
  });

  it('resolves type trueforge and mounts the layout', async () => {
    render(<TrueForgeUI server={{ type: 'trueforge', token: 'tok' }} layout="sidebar" className="h-96" />);

    await waitFor(() => {
      expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows a loader while truefoundry server init is pending', () => {
    render(
      <TrueForgeUI
        server={{
          type: 'truefoundry',
          apiKey: 'k',
          controlPlaneURL: 'https://cp.example',
        }}
        layout="sidebar"
        className="h-96"
      />,
    );

    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();
  });
});

describe('StackChatPanel', () => {
  it('shows New Chat and New Agent actions on the thread header', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider>
          <RuntimeHarness messages={[]}>
            <div className="h-96">
              <StackChatPanel />
            </div>
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );

    expect(screen.getByRole('button', { name: 'New Chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Agent' })).toBeInTheDocument();
  });

  it.each([
    ['dock/widget', StackChatPanel],
    ['drawer', DrawerLayout],
  ] as const)('%s can return to chat after opening schedules', async (_name, Layout) => {
    const server = createMockAgentUIServer({
      schedules: {
        listSchedules: vi.fn(async () => ({ data: [] })),
        getSchedule: vi.fn(),
        createSchedule: vi.fn(),
        updateSchedule: vi.fn(),
        deleteSchedule: vi.fn(),
        listScheduleRuns: vi.fn(async () => []),
        createScheduleRun: vi.fn(),
      },
    });

    function OpenSchedules() {
      const shell = useShellMode();
      return (
        <button type="button" onClick={() => shell.setSchedulesOpen(true)}>
          Open schedules
        </button>
      );
    }

    render(
      <SlotsProvider>
        <ServerProvider server={server}>
          <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'a' }}>
            <RuntimeHarness messages={[]}>
              <OpenSchedules />
              <div className="h-96">
                <Layout />
              </div>
            </RuntimeHarness>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open schedules' }));
    expect(await screen.findByRole('heading', { name: 'Scheduled Agents' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to chat' }));
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: 'Scheduled Agents' })).not.toBeInTheDocument();
    });
  });
});

describe('SidebarLayout', () => {
  it('shows the app brand in the mobile navigation drawer', () => {
    render(
      <SlotsProvider theme={{ brand: { mode: 'icon-title', name: 'Acme', icon: { src: '/acme.svg' } } }}>
        <ShellModeProvider>
          <RuntimeHarness messages={[]}>
            <div className="h-96">
              <SidebarLayout />
            </div>
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Navigation' }));

    const drawer = screen.getByRole('dialog', { name: 'Navigation' });
    expect(drawer).toHaveClass('w-18');
    expect(within(drawer).getByAltText('Acme')).toHaveAttribute('src', '/acme.svg');
    expect(within(drawer).queryByText('Acme')).not.toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Start new chat' })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: 'Start new agent' })).toBeInTheDocument();
    expect(within(drawer).queryByText('No threads yet')).not.toBeInTheDocument();
  });

  it('shows the default icon mark in the permanent rail', () => {
    const { container } = render(
      <SlotsProvider>
        <RuntimeHarness messages={[]}>
          <div className="h-96">
            <SidebarLayout />
          </div>
        </RuntimeHarness>
      </SlotsProvider>,
    );

    const mark = container.querySelector('aside svg');
    expect(mark).toHaveAttribute('viewBox', '0 0 140 140');
    expect(screen.queryByText('TrueForge')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Collapse|Expand) sidebar$/ })).not.toBeInTheDocument();
  });

  it('uses the square brand icon in the rail (not the wide wordmark)', () => {
    const { container } = render(
      <SlotsProvider
        theme={{ brand: { mode: 'logo', name: 'Acme', icon: '/acme-icon.svg', logo: '/acme-wordmark.svg' } }}
      >
        <RuntimeHarness messages={[]}>
          <div className="h-96">
            <SidebarLayout />
          </div>
        </RuntimeHarness>
      </SlotsProvider>,
    );

    expect(container.querySelector('aside img')).toHaveAttribute('src', '/acme-icon.svg');
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
  });

  it('supports icon-only branding in the rail', () => {
    const { container } = render(
      <SlotsProvider theme={{ brand: { mode: 'icon-only', name: 'Acme', icon: '/acme-icon.svg' } }}>
        <RuntimeHarness messages={[]}>
          <div className="h-96">
            <SidebarLayout />
          </div>
        </RuntimeHarness>
      </SlotsProvider>,
    );

    expect(container.querySelector('aside img')).toHaveAttribute('src', '/acme-icon.svg');
    expect(container.querySelector('aside img')).toHaveAttribute('alt', 'Acme');
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
  });

  it('shows a permanent labeled rail with New Chat and no expand control', () => {
    const { container } = render(
      <SlotsProvider theme={{ brand: { mode: 'icon-title', name: 'Acme', icon: '/acme.svg' } }}>
        <RuntimeHarness messages={[]}>
          <div className="h-96">
            <SidebarLayout />
          </div>
        </RuntimeHarness>
      </SlotsProvider>,
    );

    expect(container.querySelector('aside img')).toHaveAttribute('src', '/acme.svg');
    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start new chat' })).toBeInTheDocument();
    expect(screen.getByText('New Chat')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(Collapse|Expand) sidebar$/ })).not.toBeInTheDocument();
  });

  it('highlights New Chat, New Agent, and Settings when selected', async () => {
    render(
      <SlotsProvider theme={{ brand: { mode: 'icon-title', name: 'Acme' } }}>
        <ServerProvider server={mockServer(stubCatalog)}>
          <ShellModeProvider>
            <RuntimeHarness messages={[]}>
              <div className="h-96">
                <SidebarLayout />
              </div>
            </RuntimeHarness>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    const newChat = screen.getByRole('button', { name: 'Start new chat' });
    const newAgent = screen.getByRole('button', { name: 'Start new agent' });
    expect(newChat).toHaveAttribute('aria-current', 'page');
    expect(newAgent).not.toHaveAttribute('aria-current');

    fireEvent.click(newAgent);
    expect(newAgent).toHaveAttribute('aria-current', 'page');
    expect(newChat).not.toHaveAttribute('aria-current');

    const [settingsButton] = screen.getAllByRole('button', { name: 'Settings' });
    if (settingsButton === undefined) {
      throw new Error('Expected settings button');
    }
    expect(settingsButton).not.toHaveAttribute('aria-current');
    fireEvent.click(settingsButton);
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(settingsButton).toHaveAttribute('aria-current', 'page');
    expect(newChat).not.toHaveAttribute('aria-current');
    expect(newAgent).not.toHaveAttribute('aria-current');
  });

  it('toggles theme from the footer and shows settings only when catalog is provided', async () => {
    const { rerender } = render(
      <SlotsProvider theme={{ brand: { mode: 'icon-title', name: 'Acme' } }}>
        <ServerProvider server={mockServer(stubCatalog)}>
          <ShellModeProvider>
            <RuntimeHarness messages={[]}>
              <div className="h-96">
                <SidebarLayout />
              </div>
            </RuntimeHarness>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );

    expect(screen.getAllByRole('button', { name: 'Settings' })).toHaveLength(1);
    expect(await screen.findAllByRole('button', { name: 'Agents' })).not.toHaveLength(0);
    const [themeButton] = screen.getAllByRole('button', { name: /Switch to (light|dark) theme/ });
    if (themeButton === undefined) {
      throw new Error('Expected theme toggle');
    }
    fireEvent.click(themeButton);
    expect(screen.getAllByRole('button', { name: /Switch to (light|dark) theme/ })).toHaveLength(1);

    // Settings stays available with a locked agentName when catalog is present.
    rerender(
      <SlotsProvider theme={{ brand: { mode: 'icon-title', name: 'Acme' } }}>
        <ServerProvider server={mockServer(stubCatalog)}>
          <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'locked-agent' }}>
            <RuntimeHarness messages={[]}>
              <div className="h-96">
                <SidebarLayout />
              </div>
            </RuntimeHarness>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );
    expect(screen.getAllByRole('button', { name: 'Settings' })).toHaveLength(1);
    const [settingsButton] = screen.getAllByRole('button', { name: 'Settings' });
    if (settingsButton === undefined) {
      throw new Error('Expected settings button');
    }
    fireEvent.click(settingsButton);
    // SettingsBuilder is lazy-loaded behind Suspense in the layout.
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    rerender(
      <SlotsProvider theme={{ brand: { mode: 'icon-title', name: 'Acme' } }}>
        <ServerProvider
          server={createMockAgentUIServer({
            catalog: stubCatalog,
            getCapabilities: async () => ({
              data: {
                sandbox: { enabled: true },
                skill: { enabled: true },
                settings: { enabled: false },
              },
            }),
          })}
        >
          <ShellModeProvider>
            <RuntimeHarness messages={[]}>
              <div className="h-96">
                <SidebarLayout />
              </div>
            </RuntimeHarness>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
    });

    // No catalog → no Settings button.
    rerender(
      <SlotsProvider theme={{ brand: { mode: 'icon-title', name: 'Acme' } }}>
        <ServerProvider server={mockServer()}>
          <ShellModeProvider>
            <RuntimeHarness messages={[]}>
              <div className="h-96">
                <SidebarLayout />
              </div>
            </RuntimeHarness>
          </ShellModeProvider>
        </ServerProvider>
      </SlotsProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Switch to (light|dark) theme/ })).toHaveLength(1);
  });
});

describe('DrawerLayout a11y', () => {
  it('exposes New Chat and New Agent actions', () => {
    render(
      <SlotsProvider>
        <ShellModeProvider>
          <RuntimeHarness messages={[]}>
            <div className="h-96">
              <DrawerLayout />
            </div>
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );

    expect(screen.getByRole('button', { name: 'New Chat' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Agent' })).toBeInTheDocument();
  });
});

describe('layout slot overrides', () => {
  function CustomClearChat() {
    return <button type="button">custom clear</button>;
  }

  function CustomActionSlot() {
    return <button type="button">custom action</button>;
  }

  // dock and widget render their header through StackChatPanel.
  const hosts = [
    ['sidebar', SidebarLayout],
    ['drawer', DrawerLayout],
    ['dock/widget', StackChatPanel],
  ] as const;

  it.each(hosts)('%s honors overrides.ClearChatButton', (_name, Layout) => {
    render(
      <SlotsProvider overrides={{ ClearChatButton: CustomClearChat }}>
        <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'a' }}>
          <RuntimeHarness messages={[]}>
            <div className="h-96">
              <Layout />
            </div>
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );

    expect(screen.getByRole('button', { name: 'custom clear' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Clear chat' })).not.toBeInTheDocument();
  });

  it.each(hosts)('%s honors overrides.ShellActionsActionSlot to the right of shell actions', (_name, Layout) => {
    render(
      <SlotsProvider overrides={{ ShellActionsActionSlot: CustomActionSlot }}>
        <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'a' }}>
          <RuntimeHarness messages={[]}>
            <div className="h-96">
              <Layout />
            </div>
          </RuntimeHarness>
        </ShellModeProvider>
      </SlotsProvider>,
    );

    expect(screen.getAllByRole('button', { name: 'custom action' }).length).toBeGreaterThan(0);
  });

  const settingsCatalog: CatalogServer = {
    modelCatalog: {
      getModelProviderCatalog: vi.fn(async () => []),
      listModelProviders: vi.fn(async () => []),
      createModelProvider: vi.fn(),
      updateModelProvider: vi.fn(),
    },
    connectorCatalog: {
      getConnectorCatalog: vi.fn(async () => []),
      getConnector: vi.fn(),
      listConnectors: vi.fn(async () => []),
      getToolsByConnectorId: vi.fn(async () => []),
      createConnector: vi.fn(),
      updateConnector: vi.fn(),
      authenticateConnector: vi.fn(),
      disconnectConnector: vi.fn(),
    },
  };

  it.each(hosts)(
    '%s keeps ShellActionsActionSlot mounted when Settings opens (no remount handoff)',
    async (_name, Layout) => {
      render(
        <SlotsProvider overrides={{ ShellActionsActionSlot: CustomActionSlot }}>
          <ServerProvider server={mockServer(settingsCatalog)}>
            <ShellModeProvider agentConfig={{ mode: 'SingleAgent', name: 'a' }}>
              <RuntimeHarness messages={[]}>
                <div className="h-96">
                  <Layout />
                </div>
              </RuntimeHarness>
            </ShellModeProvider>
          </ServerProvider>
        </SlotsProvider>,
      );

      const before = screen.getAllByRole('button', { name: 'custom action' });
      expect(before.length).toBeGreaterThan(0);
      const beforeNode = before[0];

      fireEvent.click(screen.getAllByRole('button', { name: 'Settings' })[0]!);
      // SettingsBuilder is lazy-loaded behind Suspense in the layout.
      expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();

      const after = screen.getAllByRole('button', { name: 'custom action' });
      expect(after.length).toBeGreaterThan(0);
      // Same DOM node — layout did not remount the host override on Settings toggle.
      expect(after).toContain(beforeNode);
    },
  );
});

describe('WidgetLayout a11y', () => {
  it('opens chat dialog, focuses it, and restores FAB focus on Escape', async () => {
    render(
      <SlotsProvider>
        <RuntimeHarness messages={[]}>
          <div className="h-96">
            <WidgetLayout />
          </div>
        </RuntimeHarness>
      </SlotsProvider>,
    );

    const fab = screen.getByRole('button', { name: 'Open chat' });
    expect(fab).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(fab);
    const dialog = screen.getByRole('dialog', { name: 'Chat' });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => {
      expect(dialog).toHaveFocus();
    });
    expect(screen.getByRole('button', { name: 'Close chat' })).toHaveAttribute('aria-expanded', 'true');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Chat' })).not.toBeInTheDocument();
    const openFab = screen.getByRole('button', { name: 'Open chat' });
    expect(openFab).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(openFab).toHaveFocus();
    });
  });
});
