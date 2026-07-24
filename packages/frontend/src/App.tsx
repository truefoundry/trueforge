import { AssistantRuntimeProvider, useAui, useAuiState } from '@assistant-ui/react';
import { ErrorToasterProvider, SlotsProvider, Thread } from '@truefoundry/agent-ui-sdk';
import { useTrueFoundryAgentRuntime, type AgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ThemeProvider } from 'tfy-web-components/components/theme/useTheme';
import { AgentSessionClient } from 'truefoundry-gateway-sdk/agents';
import { PrivateAgentSessionClient } from 'truefoundry-gateway-sdk/agents/private';
import { ApiErrorCard } from './ApiErrorCard';
import { ServerCapabilitiesProvider } from './capabilities';
import { getCapabilities, listModels, type ServerCapabilities } from './catalog';
import { AppComposerShell } from './ComposerShell';
import { PanelLeftIcon } from './icons';
import { AppWelcomeScreen } from './slots';
import { ThreadHeader } from './ThreadHeader';
import { ThreadSidebar } from './ThreadSidebar';

const client = new AgentSessionClient({
  baseUrl: '/',
  auth: false,
});

const privateClient = new PrivateAgentSessionClient({
  baseUrl: '/',
  auth: false,
});

const slotOverrides = {
  WelcomeScreen: AppWelcomeScreen,
  ComposerShell: AppComposerShell,
  ComposerRightSection: () => null,
  ComposerLeftSection: () => null,
  ComposerSendButton: () => null,
};

/**
 * The backend generates the session title once the first turn streams. Reload
 * the thread list when streaming starts and ends so the sidebar and header
 * (both read from `threads.threadItems`) pick up the new title.
 */
function ThreadTitleSync() {
  const aui = useAui();
  const isRunning = useAuiState(state => state.threads.main.isRunning);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    void aui.threads().reload();
  }, [aui, isRunning]);
  return null;
}

function ChatApp({
  defaultAgentSpec,
  capabilities,
}: {
  defaultAgentSpec: AgentSpec;
  capabilities: ServerCapabilities;
}) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const runtime = useTrueFoundryAgentRuntime({
    client,
    privateClient,
    agent: {
      mode: 'draft',
      defaultAgentSpec,
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ServerCapabilitiesProvider capabilities={capabilities}>
        <ThemeProvider theme="dark">
          <SlotsProvider theme="dark" overrides={slotOverrides}>
            <ErrorToasterProvider>
              <ThreadTitleSync />
              <div className="app-shell">
                {sidebarOpen ? (
                  <aside className="app-sidebar">
                    <div className="sidebar-top">
                      <span className="sidebar-brand">Harness</span>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Collapse sidebar"
                        onClick={() => {
                          setSidebarOpen(false);
                        }}
                      >
                        <PanelLeftIcon />
                      </button>
                    </div>
                    <ThreadSidebar />
                  </aside>
                ) : null}
                <div className="app-main">
                  <ThreadHeader
                    sidebarCollapsed={!sidebarOpen}
                    onExpandSidebar={() => {
                      setSidebarOpen(true);
                    }}
                  />
                  <div className="app-thread-body">
                    <Thread />
                  </div>
                  <ApiErrorCard />
                </div>
              </div>
            </ErrorToasterProvider>
          </SlotsProvider>
        </ThemeProvider>
      </ServerCapabilitiesProvider>
    </AssistantRuntimeProvider>
  );
}

export function App() {
  const [defaultAgentSpec, setDefaultAgentSpec] = useState<AgentSpec | null>(null);
  const [capabilities, setCapabilities] = useState<ServerCapabilities | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.add('dark');
    return () => {
      document.documentElement.classList.remove('dark');
    };
  }, []);

  useEffect(() => {
    const state = { cancelled: false };
    void (async () => {
      try {
        const [models, serverCapabilities] = await Promise.all([listModels(), getCapabilities()]);
        const first = models[0];
        if (!first) {
          throw new Error('No models in GET /v1/models — check models.yaml');
        }
        if (!state.cancelled) {
          const defaultReasoningEffort = first.reasoning_efforts?.[0];
          setDefaultAgentSpec({
            model: {
              name: first.name,
              ...(defaultReasoningEffort ? { params: { reasoningEffort: defaultReasoningEffort } } : {}),
            },
            config: { sandbox: { enabled: serverCapabilities.sandbox.enabled } },
          });
          setCapabilities(serverCapabilities);
        }
      } catch (err) {
        if (!state.cancelled) {
          setBootError(err instanceof Error ? err.message : 'Failed to boot');
        }
      }
    })();
    return () => {
      state.cancelled = true;
    };
  }, []);

  const loading = useMemo(
    () => (defaultAgentSpec == null || capabilities == null) && bootError == null,
    [defaultAgentSpec, capabilities, bootError],
  );

  if (bootError) {
    return (
      <div className="boot-screen" data-error="true">
        Failed to load application configuration: {bootError}
        <ApiErrorCard />
      </div>
    );
  }

  if (loading || defaultAgentSpec == null || capabilities == null) {
    return (
      <div className="boot-screen">
        Loading application…
        <ApiErrorCard />
      </div>
    );
  }

  return <ChatApp defaultAgentSpec={defaultAgentSpec} capabilities={capabilities} />;
}
