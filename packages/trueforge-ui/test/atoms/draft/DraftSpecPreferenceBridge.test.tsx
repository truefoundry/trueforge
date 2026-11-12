// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftSpecPreferenceBridge, reconcileDraftMemory } from '@/atoms/draft/DraftSpecPreferenceBridge.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentSpec } from '@/server/types.js';
import { createMockAgentUIServer, tenantSessionSharing } from '../../server/mockServer.js';

let agentSpec: AgentSpec;
let draftSessionId: string | undefined;
let mode: { status: 'active'; isMutable: true; isCreateAgent: boolean; agentId?: string };
const updateAgentSpec = vi.fn();
const rememberDraftSpec = vi.fn();

vi.mock('@truefoundry/trueforge-assistant-ui-runtime', () => ({
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

function renderBridge({ memory }: { memory?: { enabled: boolean } } = {}) {
  const server = createMockAgentUIServer({
    getCapabilities: async () => ({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        sessionSharing: tenantSessionSharing,
        webSearch: { enabled: false },
        ...(memory === undefined ? {} : { memory }),
      },
    }),
  });
  return render(
    <ServerProvider server={server}>
      <DraftCatalogProvider>
        <DraftSpecPreferenceBridge />
      </DraftCatalogProvider>
    </ServerProvider>,
  );
}

beforeEach(() => {
  updateAgentSpec.mockClear();
  localStorage.clear();
  mode = { status: 'active', isMutable: true, isCreateAgent: false };
});

describe('DraftSpecPreferenceBridge web search', () => {
  it('turns web search off on a New Chat draft once the tenant switch is off', async () => {
    agentSpec = { model: { name: 'model' }, config: { webSearch: { enabled: true } } };
    draftSessionId = undefined;

    renderBridge();

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({ config: { webSearch: { enabled: false } } });
    });
  });

  it('leaves a session that already uses web search alone', async () => {
    agentSpec = { model: { name: 'model' }, config: { webSearch: { enabled: true } } };
    draftSessionId = 'session-1';

    renderBridge();

    await expectWebSearchUntouched();
  });

  it('leaves a saved agent that already uses web search alone', async () => {
    agentSpec = { model: { name: 'model' }, config: { webSearch: { enabled: true } } };
    draftSessionId = undefined;
    mode = { status: 'active', isMutable: true, isCreateAgent: true, agentId: 'agent-1' };

    renderBridge();

    await expectWebSearchUntouched();
  });

  it('turns web search off on a New Agent draft that is not saved yet', async () => {
    agentSpec = { model: { name: 'model' }, config: { webSearch: { enabled: true } } };
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
        agentSpec: { model: { name: 'model' }, config: { sandbox: { enabled: true } } },
        memoryEnabled: true,
      }),
    ).toEqual({ config: { sandbox: { enabled: true }, memory: { enabled: true } } });
  });

  it('keeps a memory choice already on the draft', () => {
    expect(
      reconcileDraftMemory({
        agentSpec: { model: { name: 'model' }, config: { memory: { enabled: false } } },
        memoryEnabled: true,
      }),
    ).toEqual({});
  });

  it('clears memory from the draft when memory is unavailable', () => {
    expect(
      reconcileDraftMemory({
        agentSpec: { model: { name: 'model' }, config: { sandbox: { enabled: true }, memory: { enabled: true } } },
        memoryEnabled: false,
      }),
    ).toEqual({ config: { sandbox: { enabled: true } } });
  });

  it('changes nothing before capabilities load', () => {
    const agentSpec = { model: { name: 'model' }, config: { memory: { enabled: true } } };

    expect(reconcileDraftMemory({ agentSpec, memoryEnabled: undefined })).toEqual({});
    expect(reconcileDraftMemory({ agentSpec: { model: { name: 'model' } }, memoryEnabled: null })).toEqual({});
  });
});

describe('DraftSpecPreferenceBridge memory', () => {
  it('turns memory on for a New Agent draft once memory is available', async () => {
    agentSpec = { model: { name: 'model' } };
    draftSessionId = undefined;
    mode = { status: 'active', isMutable: true, isCreateAgent: true };

    renderBridge({ memory: { enabled: true } });

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({ config: { memory: { enabled: true } } });
    });
  });

  it('clears memory from a New Agent draft when no memory provider is configured', async () => {
    agentSpec = { model: { name: 'model' }, config: { memory: { enabled: true } } };
    draftSessionId = undefined;
    mode = { status: 'active', isMutable: true, isCreateAgent: true };

    renderBridge();

    await waitFor(() => {
      expect(updateAgentSpec).toHaveBeenCalledWith({ config: {} });
    });
  });

  it('leaves a saved agent memory setting alone', async () => {
    agentSpec = { model: { name: 'model' }, config: { memory: { enabled: true } } };
    draftSessionId = undefined;
    mode = { status: 'active', isMutable: true, isCreateAgent: true, agentId: 'agent-1' };

    renderBridge();

    await expectMemoryUntouched();
  });
});
