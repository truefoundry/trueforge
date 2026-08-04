import {
  createTrueFoundryServer,
  TrueFoundryAssistantUI,
  useShellMode,
  WelcomeScreen,
  type SlotOverrides,
  type WelcomeScreenProps,
} from '@truefoundry/agent-ui-sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import './agentUiSlots';
import { ApiErrorCard } from './ApiErrorCard';
import { getCapabilities, listMcpServers, listModels, listSkills } from './catalog';
import { createConnectorCatalog } from './connectorCatalog';
import { createHarnessChatServer, type HarnessAgentSpec } from './harnessServer';
import { createModelProviderCatalog } from './modelProviderCatalog';

/** Harness model names are `provider/model`. */
function providerOf(name: string): string {
  return name.split('/')[0] ?? name;
}

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

const server = createTrueFoundryServer<HarnessAgentSpec>({
  chatServer: createHarnessChatServer(),
  getModels: async () => (await listModels()).map(model => ({ name: model.name, provider: providerOf(model.name) })),
  // Skills require a configured sandbox provider; keep the picker empty when skill capability is off.
  getSkills: async () => {
    const [capabilities, skills] = await Promise.all([getCapabilities(), listSkills()]);
    return capabilities.skill.enabled
      ? skills.map(skill => ({ id: skill.name, name: skill.name, description: skill.description }))
      : [];
  },
  getMcp: async () =>
    (await listMcpServers()).map(server => ({ id: server.name, name: server.name, description: server.url })),
  searchAgents: () => Promise.resolve([]),
  saveAgent: () => Promise.reject(new Error('Harness has no agent registry — sessions are draft-only')),
  catalog: {
    modelCatalog: createModelProviderCatalog(),
    connectorCatalog: createConnectorCatalog(),
    // Skills settings still deferred (UI create shape is repo/directory; Harness is git manifest).
    skillCatalog: {
      listSkills: () => Promise.resolve([]),
      createSkill: () => Promise.reject(new Error('not implemented')),
    },
  },
});

type BootState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; defaultAgentSpec: HarnessAgentSpec; openSettings: boolean };

export function App() {
  const [boot, setBoot] = useState<BootState>({ status: 'loading' });

  useEffect(() => {
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
  }, []);

  const overrides: SlotOverrides = useMemo(
    () => (boot.status === 'ready' && boot.openSettings ? { WelcomeScreen: OpenSettingsWelcomeScreen } : {}),
    [boot],
  );

  if (boot.status === 'error') {
    return (
      <div className="boot-screen" data-error="true">
        Failed to load application configuration: {boot.message}
        <ApiErrorCard />
      </div>
    );
  }

  if (boot.status === 'loading') {
    return (
      <div className="boot-screen">
        Loading application…
        <ApiErrorCard />
      </div>
    );
  }

  return (
    <div className="app-root">
      <TrueFoundryAssistantUI
        server={server}
        layout="sidebar"
        defaultAgentSpec={boot.defaultAgentSpec}
        overrides={overrides}
        theme={{ mode: 'dark' }}
        className="app-assistant"
      />
      <ApiErrorCard />
    </div>
  );
}
