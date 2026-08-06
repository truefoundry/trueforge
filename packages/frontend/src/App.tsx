import {
  createTrueFoundryServer,
  TrueforgeUI,
  useShellMode,
  WelcomeScreen,
  type SlotOverrides,
  type WelcomeScreenProps,
} from '@truefoundry/trueforge-ui';
import { useEffect, useMemo, useRef, useState } from 'react';
import './agentUiSlots';
import { fetchAuthConfig, fetchCurrentIdentity } from './auth';
import { OidcLogoutButton } from './components/OidcLogoutButton';
import { getCapabilities, listModels } from './composerLists';
import { createConnectorCatalog } from './connectorCatalog';
import { createHarnessBuilderServer } from './harnessBuilderServer';
import { createHarnessChatServer, type HarnessAgentSpec } from './harnessServer';
import { createModelProviderCatalog } from './modelProviderCatalog';
import { LoginPage } from './pages/LoginPage';
import { createSandboxProviderCatalog } from './sandboxProviderCatalog';
import { createSkillCatalog } from './skillCatalog';

/** Opens settings once when the empty welcome screen mounts (no models configured). */
function OpenSettingsWelcomeScreen(props: WelcomeScreenProps) {
  const { setSettingsOpen } = useShellMode();
  const openedRef = useRef(false);
  useEffect(() => {
    if (openedRef.current) {
      return;
    }
    openedRef.current = true;
    setSettingsOpen(true);
  }, [setSettingsOpen]);
  return <WelcomeScreen {...props} />;
}

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
  | { status: 'login' }
  | { status: 'error'; message: string }
  | { status: 'ready'; oidcEnabled: boolean; defaultAgentSpec: HarnessAgentSpec; openSettings: boolean };

export function App() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });

  useEffect(() => {
    const state = { cancelled: false };
    // Read via a call so control-flow analysis does not narrow the flag away after the first check.
    const cancelled = () => state.cancelled;
    void (async () => {
      try {
        const authConfig = await fetchAuthConfig();
        if (cancelled()) {
          return;
        }
        if (authConfig.oidc_enabled) {
          const identity = await fetchCurrentIdentity();
          if (cancelled()) {
            return;
          }
          if (!identity) {
            setBoot({ status: 'login' });
            return;
          }
        }

        const [models, capabilities] = await Promise.all([listModels(), getCapabilities()]);
        if (cancelled()) {
          return;
        }
        const first = models[0];
        const sandboxConfig = { sandbox: { enabled: capabilities.sandbox.enabled } };
        if (first === undefined) {
          setBoot({
            status: 'ready',
            oidcEnabled: authConfig.oidc_enabled,
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
          oidcEnabled: authConfig.oidc_enabled,
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
        if (!cancelled()) {
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
  }, []);

  const overrides: SlotOverrides = useMemo(() => {
    if (boot.status !== 'ready') {
      return {};
    }
    return {
      ...(boot.openSettings ? { WelcomeScreen: OpenSettingsWelcomeScreen } : {}),
      ...(boot.oidcEnabled ? { LogoutButton: OidcLogoutButton } : {}),
    };
  }, [boot]);

  if (boot.status === 'login') {
    return <LoginPage />;
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
          mode: 'AgentComposer',
          defaultAgentSpec: boot.defaultAgentSpec,
        }}
        overrides={overrides}
        className="app-assistant"
      />
    </div>
  );
}
