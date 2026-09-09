import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionListCache, withSessionListCache } from '@/server/sessionListCache.js';

import { createMockAgentUIServer } from './mockServer.js';

const emptyPage = { data: [] };

function cachedServer(overrides: Parameters<typeof createMockAgentUIServer>[0] = {}) {
  const cache = createSessionListCache();
  const server = withSessionListCache({ server: createMockAgentUIServer(overrides), cache });
  return server;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('withSessionListCache', () => {
  it('reuses a page when requests differ only by startTimestamp', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    const first = await server.listSessions({ limit: 20, startTimestamp: '2025-09-09T00:00:00.000Z' });
    const second = await server.listSessions({ limit: 20, startTimestamp: '2025-09-09T00:00:00.001Z' });

    expect(listSessions).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('fetches separately per pageToken and agentId', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    await server.listSessions({ limit: 20 });
    await server.listSessions({ limit: 20, pageToken: 'page-2' });
    await server.listSessions({ limit: 20, agentId: 'agent-x' });

    expect(listSessions).toHaveBeenCalledTimes(3);
  });

  it('clears the cache after createSession, updateSession, and deleteSession', async () => {
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const session = { id: 's1' };
    const server = cachedServer({
      listSessions,
      createSession: vi.fn().mockResolvedValue(session),
      updateSession: vi.fn().mockResolvedValue(session),
      deleteSession: vi.fn().mockResolvedValue(undefined),
    });

    await server.listSessions({ limit: 20 });
    await server.createSession({});
    await server.listSessions({ limit: 20 });
    await server.updateSession({ sessionId: 's1' });
    await server.listSessions({ limit: 20 });
    await server.deleteSession?.({ sessionId: 's1' });
    await server.listSessions({ limit: 20 });

    expect(listSessions).toHaveBeenCalledTimes(4);
  });

  it('retries after a failed page instead of replaying the rejection', async () => {
    const listSessions = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    await expect(server.listSessions({ limit: 20 })).rejects.toThrow('boom');
    await expect(server.listSessions({ limit: 20 })).resolves.toEqual(emptyPage);
    expect(listSessions).toHaveBeenCalledTimes(2);
  });

  it('expires entries after the TTL', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const listSessions = vi.fn().mockResolvedValue(emptyPage);
    const server = cachedServer({ listSessions });

    await server.listSessions({ limit: 20 });
    vi.setSystemTime(29_000);
    await server.listSessions({ limit: 20 });
    expect(listSessions).toHaveBeenCalledTimes(1);

    vi.setSystemTime(31_000);
    await server.listSessions({ limit: 20 });
    expect(listSessions).toHaveBeenCalledTimes(2);
  });
});
