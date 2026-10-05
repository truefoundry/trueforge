import { describe, expect, it, vi } from 'vitest';

import { createDraftSessionBridge } from '../../src/draft/draftSessionBridge.js';
import type { AgentChatServer, Session } from '../../src/server/types.js';

describe('createDraftSessionBridge', () => {
  it('returns agentSpec when session has agentSpec', async () => {
    const mockSession: Session = {
      id: 'session-1',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      isMutable: true,
      agentSpec: { model: { name: 'openai-main/gpt-4.1' } },
    };
    const server: AgentChatServer = {
      getSession: vi.fn().mockResolvedValue(mockSession),
      createSession: vi.fn(),
      updateSession: vi.fn(),
      createTurn: vi.fn(),
      cancelSession: vi.fn(),
      listSessions: vi.fn(),
      listTurns: vi.fn(),
      getTurn: vi.fn(),
      listEvents: vi.fn(),
    };

    const bridge = createDraftSessionBridge(server);
    const spec = await bridge.getDraftAgentSpec('session-1');
    expect(spec).toEqual({ model: { name: 'openai-main/gpt-4.1' } });
  });

  it('returns null without throwing when session has no agentSpec', async () => {
    const mockSession: Session = {
      id: 'session-immutable',
      createdAt: '2026-09-01T00:00:00.000Z',
      updatedAt: '2026-09-01T00:00:00.000Z',
      isMutable: false,
    };
    const server: AgentChatServer = {
      getSession: vi.fn().mockResolvedValue(mockSession),
      createSession: vi.fn(),
      updateSession: vi.fn(),
      createTurn: vi.fn(),
      cancelSession: vi.fn(),
      listSessions: vi.fn(),
      listTurns: vi.fn(),
      getTurn: vi.fn(),
      listEvents: vi.fn(),
    };

    const bridge = createDraftSessionBridge(server);
    const spec = await bridge.getDraftAgentSpec('session-immutable');
    expect(spec).toBeNull();
  });
});
