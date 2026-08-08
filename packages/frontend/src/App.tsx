import { createTrueFoundryServer, TrueforgeUI, type SlotOverrides } from '@truefoundry/trueforge-ui';
import { useEffect, useMemo, useState } from 'react';
import { AuthErrorScreen } from './AuthErrorScreen';
import { probeSession, type SessionState } from './authSession';
import { parseAuthErrorReason } from './authStatusSearch';
import { getCapabilities, listModels } from './composerLists';
import { createConnectorCatalog } from './connectorCatalog';
import { GetStartedScreen } from './GetStartedScreen';
import { createHarnessBuilderServer } from './harnessBuilderServer';
import { createHarnessChatServer, type HarnessAgentSpec } from './harnessServer';
import { LogoutButton } from './LogoutButton';
import { createModelProviderCatalog } from './modelProviderCatalog';
import { createSandboxProviderCatalog } from './sandboxProviderCatalog';
import { createSkillCatalog } from './skillCatalog';

const chatServer = createHarnessChatServer();

const server = createTrueFoundryServer<HarnessAgentSpec>({
  chatServer,
  ...createHarnessBuilderServer(),
  catalog: {
    modelCatalog: createModelProviderCatalog(),
    connectorCatalog: createConnectorCatalog(),
    skillCatalog: createSkillCatalog(),
    sandboxCatalog: createSandboxProviderCatalog(),
  },
});

type BootState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; defaultAgentSpec: HarnessAgentSpec; openSettings: boolean };

export function App() {
  const authError = parseAuthErrorReason(window.location.search);
  const [session, setSession] = useState<SessionState | 'checking'>('checking');
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });

  // Gate boot on a non-redirecting `/me` probe: unauthenticated users see the
  // welcome screen instead of being bounced to login by the auth-aware fetch.
  useEffect(() => {
    if (authError != null) {
      return;
    }
    const state = { cancelled: false };
    void probeSession().then(result => {
      if (!state.cancelled) {
        setSession(result);
      }
    });
    return () => {
      state.cancelled = true;
    };
  }, [authError]);

  useEffect(() => {
    if (session !== 'authenticated') {
      return;
    }
    const state = { cancelled: false };
    void (async () => {
      try {
        const [models, capabilities] = await Promise.all([listModels(), getCapabilities()]);
        if (state.cancelled) {
          return;
        }
        const first = models[0];
        const sandboxConfig = { sandbox: { enabled: capabilities.sandbox.enabled } };
        if (first === undefined) {
          setBoot({
            status: 'ready',
            openSettings: true,
            defaultAgentSpec: {
              model: { name: '' },
              config: sandboxConfig,
            },
          });
          return;
        }
        const defaultReasoningEffort = first.properties.reasoningEfforts?.[0];
        setBoot({
          status: 'ready',
          openSettings: false,
          defaultAgentSpec: {
            model: {
              name: first.name,
              ...(defaultReasoningEffort ? { params: { reasoningEffort: defaultReasoningEffort } } : {}),
            },
            config: sandboxConfig,
          },
        });
      } catch (err) {
        if (!state.cancelled) {
          setBoot({
            status: 'error',
            message: err instanceof Error ? err.message : 'Failed to boot',
          });
        }
      }
    })();
    return () => {
      state.cancelled = true;
    };
  }, [session]);

  const overrides: SlotOverrides = useMemo(() => ({ ShellActionsActionSlot: LogoutButton }), []);

  if (authError != null) {
    return <AuthErrorScreen reason={authError} />;
  }

  if (session === 'checking') {
    return <div className="boot-screen">Loading application…</div>;
  }

  if (session === 'unauthenticated') {
    return <GetStartedScreen />;
  }

  if (boot.status === 'error') {
    return (
      <div className="boot-screen" data-error="true">
        Failed to load application configuration: {boot.message}
      </div>
    );
  }

  if (boot.status === 'loading') {
    return <div className="boot-screen">Loading application…</div>;
  }

  return (
    <div className="app-root">
      <TrueforgeUI
        server={server}
        theme={{
          brand: {
            name: 'TrueForge',
          },
        }}
        layout="sidebar"
        agentConfig={{
          mode: 'AgentLibraryWithComposer',
          defaultAgentSpec: boot.defaultAgentSpec,
        }}
        initialSettingsOpen={boot.openSettings}
        overrides={overrides}
        className="app-assistant"
      />
    </div>
  );
}
