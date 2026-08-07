// @vitest-environment jsdom
import type { CatalogServer } from '@/server/types.js';
import { useExternalStoreRuntime, type ThreadMessageLike } from '@assistant-ui/react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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

import { TrueforgeUI, type ChatLayout } from '@/containers/TrueforgeUI.js';
import { DrawerLayout } from '@/layouts/DrawerLayout.js';
import { SidebarLayout } from '@/layouts/SidebarLayout.js';
import { StackChatPanel } from '@/layouts/StackChatPanel.js';
import { WidgetLayout } from '@/layouts/WidgetLayout.js';
import { ServerProvider } from '@/server/ServerContext.js';
import { ShellModeProvider } from '@/server/ShellModeContext.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';
import { RuntimeHarness } from './RuntimeHarness.js';

function mockServer(catalog?: CatalogServer) {
  return createMockAgentUIServer(catalog === undefined ? {} : { catalog });
}

/** Minimal catalog stub — ShellActions only checks presence. */
const stubCatalog = createMockCatalog();

describe('TrueforgeUI', () => {
  const server = mockServer();
  const layouts: ChatLayout[] = ['sidebar', 'drawer', 'dock', 'widget'];

  it.each(layouts)('mounts layout=%s without crashing', async layout => {
    const { container } = render(
      <TrueforgeUI
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
          expect(screen.getByRole('button', { name: /^(Collapse|Expand) sidebar$/ })).toBeInTheDocument();
          break;
        case 'drawer':
          expect(screen.getByRole('button', { name: 'New chat' })).toBeInTheDocument();
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
      <TrueforgeUI
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
        <TrueforgeUI
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

  it('surfaces trueforge-not-implemented as an alert', async () => {
    const onError = vi.fn();
    render(
      <TrueforgeUI server={{ type: 'trueforge', apiKey: 'k' }} layout="sidebar" className="h-96" onError={onError} />,
    );

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/trueforge.*not implemented/i);
    });
    expect(onError).toHaveBeenCalled();
  });

  it('shows a loader while truefoundry server init is pending', () => {
    render(
      <TrueforgeUI
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
  it('starts on a new chat and opens the session list from history', () => {
    render(
      <SlotsProvider>
        <RuntimeHarness messages={[]}>
          <div className="h-96">
            <StackChatPanel />
          </div>
        </RuntimeHarness>
      </SlotsProvider>,
    );

    expect(screen.getByLabelText('Sessions')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start new chat' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Sessions'));

    expect(screen.getByRole('button', { name: 'Start new chat' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Sessions')).not.toBeInTheDocument();
  });
});

describe('SidebarLayout', () => {
  it('shows the app brand in the mobile sessions drawer', () => {
    render(
      <SlotsProvider theme={{ brand: { name: 'Acme', icon: { src: '/acme.svg', alt: 'Acme logo' } } }}>
        <RuntimeHarness messages={[]}>
          <div className="h-96">
            <SidebarLayout />
          </div>
        </RuntimeHarness>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));

    const drawer = screen.getByRole('dialog', { name: 'Sessions' });
    expect(within(drawer).getByText('Acme')).toBeInTheDocument();
    expect(within(drawer).getByAltText('Acme logo')).toBeInTheDocument();
  });

  it('shows the brand and toggles the desktop sidebar rail', () => {
    const { unmount } = render(
      <SlotsProvider theme={{ brand: { name: 'Acme' } }}>
        <RuntimeHarness messages={[]}>
          <div className="h-96">
            <SidebarLayout />
          </div>
        </RuntimeHarness>
      </SlotsProvider>,
    );

    expect(screen.getByText('Acme')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(screen.queryByText('Acme')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start new chat' })).toBeInTheDocument();

    // New Chat / Agents remount ChatProvider via runtimeKey; collapse must survive.
    unmount();
    render(
      <SlotsProvider theme={{ brand: { name: 'Acme' } }}>
        <RuntimeHarness messages={[]}>
          <div className="h-96">
            <SidebarLayout />
          </div>
        </RuntimeHarness>
      </SlotsProvider>,
    );
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('toggles theme from the footer and shows settings only when catalog is provided', async () => {
    const { rerender } = render(
      <SlotsProvider theme={{ brand: { name: 'Acme' } }}>
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

    expect(screen.getAllByRole('button', { name: 'Settings' })).toHaveLength(2);
    const expandButton = screen.queryByRole('button', { name: 'Expand sidebar' });
    if (expandButton != null) {
      fireEvent.click(expandButton);
    }
    expect(await screen.findAllByRole('button', { name: 'Agents Library (0)' })).not.toHaveLength(0);
    const [themeButton] = screen.getAllByRole('button', { name: /Switch to (light|dark) theme/ });
    if (themeButton === undefined) {
      throw new Error('Expected theme toggle');
    }
    fireEvent.click(themeButton);
    expect(screen.getAllByRole('button', { name: /Switch to (light|dark) theme/ })).toHaveLength(2);

    // Settings stays available with a locked agentName when catalog is present.
    rerender(
      <SlotsProvider theme={{ brand: { name: 'Acme' } }}>
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
    expect(screen.getAllByRole('button', { name: 'Settings' })).toHaveLength(2);
    const [settingsButton] = screen.getAllByRole('button', { name: 'Settings' });
    if (settingsButton === undefined) {
      throw new Error('Expected settings button');
    }
    fireEvent.click(settingsButton);
    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();

    rerender(
      <SlotsProvider theme={{ brand: { name: 'Acme' } }}>
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
      <SlotsProvider theme={{ brand: { name: 'Acme' } }}>
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
    expect(screen.getAllByRole('button', { name: /Switch to (light|dark) theme/ })).toHaveLength(2);
  });
});

describe('DrawerLayout a11y', () => {
  it('opens sessions panel, focuses dialog, and restores focus on Escape', async () => {
    render(
      <SlotsProvider>
        <RuntimeHarness messages={[]}>
          <div className="h-96">
            <DrawerLayout />
          </div>
        </RuntimeHarness>
      </SlotsProvider>,
    );

    const sessionsBtn = screen.getByRole('button', { name: 'Sessions' });
    expect(sessionsBtn).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(sessionsBtn);
    expect(sessionsBtn).toHaveAttribute('aria-expanded', 'true');
    const dialog = screen.getByRole('dialog', { name: 'Sessions' });
    expect(dialog).toBeInTheDocument();
    await waitFor(() => {
      expect(dialog).toHaveFocus();
    });

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Sessions' })).not.toBeInTheDocument();
    expect(sessionsBtn).toHaveAttribute('aria-expanded', 'false');
    await waitFor(() => {
      expect(sessionsBtn).toHaveFocus();
    });
  });

  it('closes sessions panel when backdrop is clicked', () => {
    render(
      <SlotsProvider>
        <RuntimeHarness messages={[]}>
          <div className="h-96">
            <DrawerLayout />
          </div>
        </RuntimeHarness>
      </SlotsProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Sessions' }));
    expect(screen.getByRole('dialog', { name: 'Sessions' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close sessions' }));
    expect(screen.queryByRole('dialog', { name: 'Sessions' })).not.toBeInTheDocument();
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
    (_name, Layout) => {
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
      expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument();

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
