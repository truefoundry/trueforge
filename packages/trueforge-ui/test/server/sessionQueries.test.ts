import { describe, expect, it, vi } from 'vitest';

import { createServerQueryClient } from '@/server/queryClient.js';
import { withSessionQueries } from '@/server/sessionQueries.js';
import type { AgentUIServer, Session } from '@/server/types.js';

import { createMockAgentUIServer } from './mockServer.js';

const emptyPage = { data: [] };

function session(overrides: Partial<Session> = {}): Session {
  return {
    id: 's1',
    isMutable: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function cachedServer(overrides: Partial<AgentUIServer> = {}) {
  return withSessionQueries({ server: createMockAgentUIServer(overrides), queryClient: createServerQueryClient() });
}

describe('withSessionQueries listSessions', () => {
  it('reuses a page when requests differ only by startTimestamp', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    await server.listSessions({ limit: 20, startTimestamp: '2025-09-09T00:00:00.000Z' });
    await server.listSessions({ limit: 20, startTimestamp: '2025-09-09T00:00:00.001Z' });

    expect(listSessions).toHaveBeenCalledTimes(1);
  });

  it('fetches separately per pageToken and agentId', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    await server.listSessions({ limit: 20 });
    await server.listSessions({ limit: 20, pageToken: 'page-2' });
    await server.listSessions({ limit: 20, agentId: 'agent-x' });

    expect(listSessions).toHaveBeenCalledTimes(3);
  });

  it('refetches after createSession, updateSession, renameSession, and deleteSession', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({
      listSessions,
      createSession: vi.fn().mockResolvedValue(session()),
      updateSession: vi.fn().mockResolvedValue(session()),
      renameSession: vi.fn().mockResolvedValue(undefined),
      deleteSession: vi.fn().mockResolvedValue(undefined),
    });

    await server.listSessions({ limit: 20 });
    await server.createSession({});
    await server.listSessions({ limit: 20 });
    await server.updateSession({ sessionId: 's1' });
    await server.listSessions({ limit: 20 });
    await server.renameSession?.({ sessionId: 's1', title: 'Renamed' });
    await server.listSessions({ limit: 20 });
    await server.deleteSession?.({ sessionId: 's1' });
    await server.listSessions({ limit: 20 });

    expect(listSessions).toHaveBeenCalledTimes(5);
  });

  it('retries after a failed page instead of replaying the rejection', async () => {
    const listSessions = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    await expect(server.listSessions({ limit: 20 })).rejects.toThrow('boom');
    await expect(server.listSessions({ limit: 20 })).resolves.toEqual(emptyPage);
    expect(listSessions).toHaveBeenCalledTimes(2);
  });
});

describe('withSessionQueries history', () => {
  it('reuses history pages until the session updatedAt changes', async () => {
    const getSession = vi
      .fn()
      .mockResolvedValueOnce(session())
      .mockResolvedValue(session({ updatedAt: '2026-01-02T00:00:00.000Z' }));
    const listEvents = vi.fn().mockResolvedValue(emptyPage);
    const queryClient = createServerQueryClient();
    const server = withSessionQueries({ server: createMockAgentUIServer({ getSession, listEvents }), queryClient });

    await server.getSession({ sessionId: 's1' });
    await server.listEvents({ sessionId: 's1' });
    await server.listEvents({ sessionId: 's1' });
    await server.listEvents({ sessionId: 's1', pageToken: 'older' });
    expect(listEvents).toHaveBeenCalledTimes(2);

    await queryClient.invalidateQueries();
    await server.getSession({ sessionId: 's1' });
    await server.listEvents({ sessionId: 's1' });
    expect(listEvents).toHaveBeenCalledTimes(3);
  });

  it('reads history from the network while the last turn runs or for a rewind', async () => {
    const running = session({ lastTurnDetails: { id: 't1', state: { status: 'running' } } });
    const listEvents = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ getSession: vi.fn().mockResolvedValue(running), listEvents });

    await server.listEvents({ sessionId: 's1' });
    await server.listEvents({ sessionId: 's1' });
    await server.listEvents({ sessionId: 's1', lastTurnId: 't1' });

    expect(listEvents).toHaveBeenCalledTimes(3);
  });

  it('serves a re-opened idle session from cache without any request', async () => {
    const getSession = vi.fn().mockResolvedValue(session());
    const listEvents = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ getSession, listEvents });

    for (let open = 0; open < 2; open += 1) {
      await server.getSession({ sessionId: 's1' });
      await server.listEvents({ sessionId: 's1' });
    }

    expect(getSession).toHaveBeenCalledTimes(1);
    expect(listEvents).toHaveBeenCalledTimes(1);
  });

  it('revalidates detail after this tab starts, resumes, or cancels a turn', async () => {
    const getSession = vi.fn().mockResolvedValue(session());
    const server = cachedServer({
      getSession,
      sendTurnEvents: vi.fn().mockResolvedValue([]),
      cancelSession: vi.fn().mockResolvedValue(undefined),
    });

    await server.getSession({ sessionId: 's1' });
    server.createTurn({ sessionId: 's1', input: [] });
    await server.getSession({ sessionId: 's1' });
    await server.sendTurnEvents({ sessionId: 's1', turnId: 't1', events: [] });
    await server.getSession({ sessionId: 's1' });
    await server.cancelSession({ sessionId: 's1' });
    await server.getSession({ sessionId: 's1' });

    expect(getSession).toHaveBeenCalledTimes(4);
  });

  it('revalidates detail when a list shows the session changed elsewhere', async () => {
    const getSession = vi.fn().mockResolvedValue(session());
    const newer = session({ updatedAt: '2026-01-03T00:00:00.000Z' });
    const server = cachedServer({ getSession, listSessions: vi.fn().mockResolvedValue({ data: [newer] }) });

    await server.getSession({ sessionId: 's1' });
    await server.listSessions({ limit: 20 });
    await server.getSession({ sessionId: 's1' });

    expect(getSession).toHaveBeenCalledTimes(2);
  });

  it('drops cached history when the session is deleted', async () => {
    const getSession = vi.fn().mockResolvedValue(session());
    const listEvents = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ getSession, listEvents, deleteSession: vi.fn().mockResolvedValue(undefined) });

    await server.listEvents({ sessionId: 's1' });
    await server.deleteSession?.({ sessionId: 's1' });
    await server.listEvents({ sessionId: 's1' });

    expect(getSession).toHaveBeenCalledTimes(2);
    expect(listEvents).toHaveBeenCalledTimes(2);
  });
});
