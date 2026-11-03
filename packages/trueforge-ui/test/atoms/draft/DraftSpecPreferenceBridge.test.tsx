// @vitest-environment jsdom
import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DraftCatalogProvider } from '@/atoms/draft/DraftCatalogProvider.js';
import { DraftSpecPreferenceBridge } from '@/atoms/draft/DraftSpecPreferenceBridge.js';
import { ServerProvider } from '@/server/ServerContext.js';
import type { AgentSpec } from '@/server/types.js';
import { createMockAgentUIServer } from '../../server/mockServer.js';

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

function renderBridge() {
  const server = createMockAgentUIServer({
    getCapabilities: async () => ({
      data: {
        sandbox: { enabled: true },
        skill: { enabled: true },
        webSearch: { enabled: false },
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
