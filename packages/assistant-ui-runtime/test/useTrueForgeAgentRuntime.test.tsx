// @vitest-environment jsdom
import type { RemoteThreadListAdapter, RemoteThreadListOptions } from '@assistant-ui/core';
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentChatServer, AgentSpec } from '../src/server/types.js';
import { useTrueForgeAgentRuntime } from '../src/useTrueForgeAgentRuntime.js';

const runtimeMock = vi.hoisted<{
  adapters: RemoteThreadListAdapter[];
}>(() => ({ adapters: [] }));

vi.mock('@assistant-ui/core/react', () => ({
  useRemoteThreadListRuntime: (options: RemoteThreadListOptions) => {
    runtimeMock.adapters.push(options.adapter);
    return {};
  },
}));

const draftSpec: AgentSpec = {
  model: { name: 'anthropic/claude-sonnet-4-6' },
};

function mockServer(): AgentChatServer {
  return {
    createSession: vi.fn(async () => ({
      id: 'session',
      createdAt: '2026-09-09T00:00:00.000Z',
      updatedAt: '2026-09-09T00:00:00.000Z',
      isMutable: false,
    })),
    listSessions: vi.fn(async () => ({ data: [] })),
    getSession: vi.fn(),
    updateSession: vi.fn(),
    createTurn: vi.fn(),
    cancelSession: vi.fn(),
    listTurns: vi.fn(),
    getTurn: vi.fn(),
    listEvents: vi.fn(),
  };
}

describe('useTrueForgeAgentRuntime', () => {
  beforeEach(() => {
    runtimeMock.adapters.length = 0;
  });

  it('keeps loaded pages while using the latest mode to initialize sessions', async () => {
    const server = mockServer();
    const { rerender } = renderHook(
      ({ named }: { named: boolean }) =>
        useTrueForgeAgentRuntime({
          server,
          listSessionsCreatedByMe: true,
          agent: named ? { mode: 'named', agentName: 'support' } : { mode: 'draft', defaultAgentSpec: draftSpec },
        }),
      { initialProps: { named: false } },
    );
    const draftAdapter = runtimeMock.adapters.at(-1);
    if (draftAdapter === undefined) {
      throw new Error('Expected the runtime to receive a thread-list adapter.');
    }

    await draftAdapter.list();
    await draftAdapter.list({ after: 'page-2' });
    expect(server.listSessions).toHaveBeenCalledWith(expect.objectContaining({ createdByMe: true }));

    rerender({ named: true });

    expect(runtimeMock.adapters.at(-1)).toBe(draftAdapter);
    await draftAdapter.initialize('local-named');
    expect(server.createSession).toHaveBeenLastCalledWith({
      agentName: 'support',
    });

    rerender({ named: false });
    expect(runtimeMock.adapters.at(-1)).toBe(draftAdapter);
    await draftAdapter.initialize('local-draft');
    expect(server.createSession).toHaveBeenLastCalledWith({
      agentSpec: draftSpec,
    });
  });
});
