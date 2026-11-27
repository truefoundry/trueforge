// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftSpecPreferenceBridge, reconcileDraftMemory } from '@/atoms/draft/DraftSpecPreferenceBridge.js';
import {
  chatAutoModelDefaultPending,
  markChatAutoModelDefaulted,
  writeDraftSpecPreferences,
} from '@/server/draftSpecPreferences.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentBuilderCapabilitiesResponse, AgentSpec, ConfigurationServer } from '@/server/types.js';
import { createMockAgentUIServer, tenantSessionSharing } from '../../server/mockServer.js';

const TENANT_CANDIDATES = ['acct/haiku', 'acct/sonnet', 'acct/luna', 'acct/fable'];
const AUTO = { type: 'auto' as const, candidateModels: TENANT_CANDIDATES };
const tenantConfiguration: ConfigurationServer = {
  getConfiguration: async () => ({
    webSearch: { enabled: true },
    memory: { enabled: true },
    autoModelRouting: { enabled: true, candidateModels: TENANT_CANDIDATES },
  }),
  updateConfiguration: vi.fn(),
};

let agentSpec: AgentSpec;
let draftSessionId: string | undefined;
let mode: { status: 'active'; isMutable: true; isCreateAgent: boolean; agentId?: string };
const updateAgentSpec = vi.fn();
const rememberDraftSpec = vi.fn();

vi.mock('@truefoundry/trueforge-assistant-ui-runtime', async importOriginal => ({
  ...(await importOriginal<typeof import('@truefoundry/trueforge-assistant-ui-runtime')>()),
  useTrueForgeAgentSpec: () => ({ agentSpec, draftSessionId, isSpecLoading: false }),
  useTrueForgeUpdateAgentSpec: () => updateAgentSpec,
}));

vi.mock('@/server/ShellModeContext.js', () => ({
  useShellMode: () => ({ mode, pendingSessionId: undefined, rememberDraftSpec }),
}));

/** Nothing forced web search off on this draft. */
async function expectWebSearchUntouched() {
  await new Promise(resolve => setTimeout(resolve, 50));
  for (const [update] of updateAgentSpec.mock.calls) {
    expect(update.config?.webSearch).not.toEqual({ enabled: false });
  }
}

/** No update set or cleared memory on this draft. */
async function expectMemoryUntouched() {
  await new Promise(resolve => setTimeout(resolve, 50));
  for (const [update] of updateAgentSpec.mock.calls) {
    if (update.config !== undefined) {
      expect(update.config.memory).toEqual(agentSpec.config?.memory);
    }
  }
}

function renderBridge({
  memory,
  auto = { status: 'not_configured' },
  configuration = tenantConfiguration,
}: {
  memory?: { enabled: boolean };
  auto?: AgentBuilderCapabilitiesResponse['data']['auto'];
  configuration?: ConfigurationServer;
} = {}) {
  const server = createMockAgentUIServer({
    configuration,
    getCapabilities: async () => ({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        auto,
        sessionSharing: tenantSessionSharing,
        webSearch: { enabled: false },
        ...(memory === undefined ? {} : { memory }),
      },
    }),
  });
  const tree = () => (
    <ServerProvider server={server}>
      <DraftCatalogProvider>
        <DraftSpecPreferenceBridge />
      </DraftCatalogProvider>
    </ServerProvider>
  );
  const result = render(tree());
  return { ...result, rerenderBridge: () => result.rerender(tree()) };
}

beforeEach(() => {
  updateAgentSpec.mockClear();
  localStorage.clear();
  mode = { status: 'active', isMutable: true, isCreateAgent: false };
});

describe('DraftSpecPreferenceBridge web search', () => {
  it('turns web search off on a New Chat draft once the tenant switch is off', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' }, config: { webSearch: { enabled: true } } };
    draftSessionId = undefined;

    renderBridge();

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({ config: { webSearch: { enabled: false } } });
    });
  });

  it('leaves a session that already uses web search alone', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' }, config: { webSearch: { enabled: true } } };
    draftSessionId = 'session-1';

    renderBridge();

    await expectWebSearchUntouched();
  });

  it('leaves a saved agent that already uses web search alone', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' }, config: { webSearch: { enabled: true } } };
    draftSessionId = undefined;
    mode = { status: 'active', isMutable: true, isCreateAgent: true, agentId: 'agent-1' };

    renderBridge();

    await expectWebSearchUntouched();
  });

  it('turns web search off on a New Agent draft that is not saved yet', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' }, config: { webSearch: { enabled: true } } };
    draftSessionId = undefined;
    mode = { status: 'active', isMutable: true, isCreateAgent: true };

    renderBridge();

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({ config: { webSearch: { enabled: false } } });
    });
  });
});

describe('reconcileDraftMemory', () => {
  it('turns memory on when it is available and the draft has not set it', () => {
    expect(
      reconcileDraftMemory({
        agentSpec: { model: { type: 'fixed' as const, name: 'model' }, config: { sandbox: { enabled: true } } },
        memoryEnabled: true,
      }),
    ).toEqual({ config: { sandbox: { enabled: true }, memory: { enabled: true } } });
  });

  it('keeps a memory choice already on the draft', () => {
    expect(
      reconcileDraftMemory({
        agentSpec: { model: { type: 'fixed' as const, name: 'model' }, config: { memory: { enabled: false } } },
        memoryEnabled: true,
      }),
    ).toEqual({});
  });

  it('clears memory that is on when memory is unavailable, but keeps an explicit off', () => {
    expect(
      reconcileDraftMemory({
        agentSpec: {
          model: { type: 'fixed' as const, name: 'model' },
          config: { sandbox: { enabled: true }, memory: { enabled: true } },
        },
        memoryEnabled: false,
      }),
    ).toEqual({ config: { sandbox: { enabled: true } } });
    expect(
      reconcileDraftMemory({
        agentSpec: { model: { type: 'fixed' as const, name: 'model' }, config: { memory: { enabled: false } } },
        memoryEnabled: false,
      }),
    ).toEqual({});
  });

  it('turns a leftover off back on when memory returns, unless the off was stored', () => {
    const agentSpec = { model: { type: 'fixed' as const, name: 'model' }, config: { memory: { enabled: false } } };

    expect(reconcileDraftMemory({ agentSpec, memoryEnabled: true, previousMemoryEnabled: false })).toEqual({
      config: { memory: { enabled: true } },
    });
    expect(
      reconcileDraftMemory({ agentSpec, memoryEnabled: true, previousMemoryEnabled: false, explicitOff: true }),
    ).toEqual({});
  });

  it('changes nothing before capabilities load', () => {
    const agentSpec = { model: { type: 'fixed' as const, name: 'model' }, config: { memory: { enabled: true } } };

    expect(reconcileDraftMemory({ agentSpec, memoryEnabled: undefined })).toEqual({});
    expect(
      reconcileDraftMemory({ agentSpec: { model: { type: 'fixed' as const, name: 'model' } }, memoryEnabled: null }),
    ).toEqual({});
  });
});

describe('DraftSpecPreferenceBridge memory', () => {
  it('turns memory on for a New Agent draft once memory is available', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' } };
    draftSessionId = undefined;
    mode = { status: 'active', isMutable: true, isCreateAgent: true };

    renderBridge({ memory: { enabled: true } });

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({ config: { memory: { enabled: true } } });
    });
  });

  it('clears memory from a New Agent draft when no memory provider is configured', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' }, config: { memory: { enabled: true } } };
    draftSessionId = undefined;
    mode = { status: 'active', isMutable: true, isCreateAgent: true };

    renderBridge();

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({ config: {} });
    });
  });

  it('keeps a remembered memory off on a New Agent draft', async () => {
    writeDraftSpecPreferences('agent', {
      model: { type: 'fixed' as const, name: 'model' },
      config: { memory: { enabled: false } },
    });
    agentSpec = { model: { type: 'fixed' as const, name: 'model' }, config: { memory: { enabled: false } } };
    draftSessionId = undefined;
    mode = { status: 'active', isMutable: true, isCreateAgent: true };

    renderBridge({ memory: { enabled: true } });

    await expectMemoryUntouched();
  });

  it('leaves a New Chat draft without memory', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' } };
    draftSessionId = undefined;

    renderBridge({ memory: { enabled: true } });

    await expectMemoryUntouched();
  });

  it('leaves a saved agent memory setting alone', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' }, config: { memory: { enabled: true } } };
    draftSessionId = undefined;
    mode = { status: 'active', isMutable: true, isCreateAgent: true, agentId: 'agent-1' };

    renderBridge();

    await expectMemoryUntouched();
  });
});

describe('DraftSpecPreferenceBridge Auto default', () => {
  it('switches a New Chat draft to Auto the first time the capability is enabled', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' } };
    draftSessionId = undefined;

    renderBridge({ auto: { status: 'enabled' } });

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({ model: AUTO });
    });
    expect(chatAutoModelDefaultPending()).toBe(false);
  });

  it('does not switch again once the Auto default marker is stored', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' } };
    draftSessionId = undefined;
    markChatAutoModelDefaulted(agentSpec, AUTO);
    writeDraftSpecPreferences('chat', { model: { type: 'fixed' as const, name: 'model' } });
    updateAgentSpec.mockClear();

    renderBridge({ auto: { status: 'enabled' } });

    await new Promise(resolve => setTimeout(resolve, 50));
    for (const [update] of updateAgentSpec.mock.calls) {
      expect(update.model).not.toEqual(AUTO);
    }
  });

  it('switches to Auto only once when storage cannot keep the marker', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' } };
    draftSessionId = undefined;
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded');
    });

    const { rerenderBridge } = renderBridge({ auto: { status: 'enabled' } });
    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({ model: AUTO });
    });

    updateAgentSpec.mockClear();
    agentSpec = { model: { type: 'fixed' as const, name: 'picked' } };
    rerenderBridge();
    await new Promise(resolve => setTimeout(resolve, 50));
    setItemSpy.mockRestore();

    for (const [update] of updateAgentSpec.mock.calls) {
      expect(update.model).not.toEqual(AUTO);
    }
  });

  it("waits for the tenant's candidate models before switching to Auto", async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' } };
    draftSessionId = undefined;

    renderBridge({
      auto: { status: 'enabled' },
      configuration: { getConfiguration: () => new Promise(() => {}), updateConfiguration: vi.fn() },
    });

    await new Promise(resolve => setTimeout(resolve, 50));
    for (const [update] of updateAgentSpec.mock.calls) {
      expect(update.model).not.toEqual(AUTO);
    }
    expect(chatAutoModelDefaultPending()).toBe(true);
  });

  it('leaves the Auto default pending when Auto is not configured', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' } };
    draftSessionId = undefined;

    renderBridge({ auto: { status: 'not_configured' } });

    await new Promise(resolve => setTimeout(resolve, 50));
    for (const [update] of updateAgentSpec.mock.calls) {
      expect(update.model).not.toEqual(AUTO);
    }
    expect(chatAutoModelDefaultPending()).toBe(true);
  });

  it.each([
    ['not configured', { status: 'not_configured' as const }],
    ['disabled', { status: 'disabled' as const, reason: 'Auto mode is turned off for this tenant' }],
  ])("does not read the tenant's configuration while Auto is %s", async (_label, auto) => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' } };
    draftSessionId = undefined;
    const getConfiguration = vi.fn(tenantConfiguration.getConfiguration);

    renderBridge({ auto, configuration: { ...tenantConfiguration, getConfiguration } });

    await new Promise(resolve => setTimeout(resolve, 50));
    expect(getConfiguration).not.toHaveBeenCalled();
  });

  it("reads the tenant's configuration once Auto is enabled", async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'model' } };
    draftSessionId = undefined;
    const getConfiguration = vi.fn(tenantConfiguration.getConfiguration);

    renderBridge({ auto: { status: 'enabled' }, configuration: { ...tenantConfiguration, getConfiguration } });

    await waitFor(() => expect(getConfiguration).toHaveBeenCalled());
  });
});

describe('DraftSpecPreferenceBridge reasoning effort', () => {
  it('clears a sticky effort only once the selection moves onto a model without efforts', async () => {
    agentSpec = { model: { type: 'fixed' as const, name: 'plain', params: { reasoningEffort: 'high' } } };
    draftSessionId = undefined;
    const server = createMockAgentUIServer({
      getModels: async () => [
        { id: 'reasoning', name: 'reasoning', provider: { name: 'P' }, properties: { reasoningEfforts: ['high'] } },
        { id: 'plain', name: 'plain', provider: { name: 'P' }, properties: {} },
      ],
    });
    const tree = () => (
      <ServerProvider server={server}>
        <DraftCatalogProvider>
          <DraftSpecPreferenceBridge />
        </DraftCatalogProvider>
      </ServerProvider>
    );
    const { rerender } = render(tree());
    await new Promise(resolve => setTimeout(resolve, 50));
    const clearsEffort = expect.objectContaining({
      model: { type: 'fixed' as const, name: 'plain', params: { reasoningEffort: undefined } },
    });
    expect(updateAgentSpec).not.toHaveBeenCalledWith(clearsEffort);

    agentSpec = { model: { type: 'fixed' as const, name: 'reasoning', params: { reasoningEffort: 'high' } } };
    rerender(tree());
    agentSpec = { model: { type: 'fixed' as const, name: 'plain', params: { reasoningEffort: 'high' } } };
    rerender(tree());

    await waitFor(() => expect(updateAgentSpec).toHaveBeenCalledWith(clearsEffort));
  });
});
