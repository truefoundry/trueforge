import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { ErrorToasterProvider, SlotsProvider, Thread, ThreadListContainer } from '@truefoundry/agent-ui-sdk';
import { useTrueFoundryAgentRuntime, type AgentSpec } from '@truefoundry/assistant-ui-runtime';
import { useEffect, useMemo, useState } from 'react';
import { ThemeProvider } from 'tfy-web-components/components/theme/useTheme';
import { AgentSessionClient } from 'truefoundry-gateway-sdk/agents';
import { PrivateAgentSessionClient } from 'truefoundry-gateway-sdk/agents/private';
import { ServerCapabilitiesProvider } from './capabilities';
import { getCapabilities, listModels, type ServerCapabilities } from './catalog';
import { AppComposerShell } from './ComposerShell';
import {
  AppThreadListEmptyState,
  AppThreadListNewButton,
  AppThreadListRow,
  AppThreadListShell,
  AppWelcomeScreen,
} from './slots';
import { ThreadHeader } from './ThreadHeader';

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
  ThreadListShell: AppThreadListShell,
  ThreadListNewButton: AppThreadListNewButton,
  ThreadListEmptyState: AppThreadListEmptyState,
  ThreadListRow: AppThreadListRow,
};

function ChatApp({
  defaultAgentSpec,
  capabilities,
}: {
  defaultAgentSpec: AgentSpec;
  capabilities: ServerCapabilities;
}) {
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
              <div className="app-shell">
                <aside className="app-sidebar">
                  <ThreadListContainer />
                </aside>
                <div className="app-main">
                  <ThreadHeader />
                  <div className="app-thread-body">
                    <Thread />
                  </div>
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
          setDefaultAgentSpec({
            model: { name: first.name },
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
      </div>
    );
  }

  if (loading || defaultAgentSpec == null || capabilities == null) {
    return <div className="boot-screen">Loading application…</div>;
  }

  return <ChatApp defaultAgentSpec={defaultAgentSpec} capabilities={capabilities} />;
}
