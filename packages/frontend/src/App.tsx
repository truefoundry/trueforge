import { createTrueFoundryServer, TrueFoundryAssistantUI } from '@truefoundry/agent-ui-sdk';
import { useEffect, useMemo, useState } from 'react';
import { ApiErrorCard } from './ApiErrorCard';
import { getCapabilities, listMcpServers, listModels, listSkills } from './catalog';
import { createHarnessChatServer, toSkillMount, type HarnessAgentSpec } from './harnessServer';

/** Harness model names are `provider/model`. */
function providerOf(name: string): string {
  return name.split('/')[0] ?? name;
}

const server = createTrueFoundryServer<HarnessAgentSpec>({
  chatServer: createHarnessChatServer({ listSkills }),
  getModels: async () => (await listModels()).map(model => ({ name: model.name, provider: providerOf(model.name) })),
  // Harness rejects skills outright when it has no sandbox provider, so an unusable picker stays empty.
  getSkills: async () => {
    const [capabilities, skills] = await Promise.all([getCapabilities(), listSkills()]);
    return capabilities.sandbox.enabled ? skills.map(toSkillMount) : [];
  },
  getMcp: async () =>
    (await listMcpServers()).map(server => ({ id: server.name, name: server.name, description: server.url })),
  searchAgents: () => Promise.resolve([]),
  saveAgent: () => Promise.reject(new Error('Harness has no agent registry — sessions are draft-only')),
});

export function App() {
  const [defaultAgentSpec, setDefaultAgentSpec] = useState<HarnessAgentSpec | null>(null);
  const [bootError, setBootError] = useState<string | null>(null);

  useEffect(() => {
    const state = { cancelled: false };
    void (async () => {
      try {
        const [models, capabilities] = await Promise.all([listModels(), getCapabilities()]);
        const first = models[0];
        if (!first) {
          throw new Error('No models in GET /api/v1/models — check models.yaml');
        }
        if (!state.cancelled) {
          const defaultReasoningEffort = first.reasoning_efforts?.[0];
          setDefaultAgentSpec({
            model: {
              name: first.name,
              ...(defaultReasoningEffort ? { params: { reasoningEffort: defaultReasoningEffort } } : {}),
            },
            config: { sandbox: { enabled: capabilities.sandbox.enabled } },
          });
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

  const loading = useMemo(() => defaultAgentSpec == null && bootError == null, [defaultAgentSpec, bootError]);

  if (bootError) {
    return (
      <div className="boot-screen" data-error="true">
        Failed to load application configuration: {bootError}
        <ApiErrorCard />
      </div>
    );
  }

  if (loading || defaultAgentSpec == null) {
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
        defaultAgentSpec={defaultAgentSpec}
        theme={{ mode: 'dark' }}
        className="app-assistant"
      />
      <ApiErrorCard />
    </div>
  );
}
