import { describe, expect, it, vi } from 'vitest';

import type { AgentChatServer, Session } from '../src/server/index.js';

import { createTrueForgeThreadListAdapter } from '../src/trueforgeThreadListAdapter.js';

function mockSession(id: string, title: string, updatedAt: string, agentName?: string): Session {
  return {
    id,
    title,
    updatedAt,
    createdAt: updatedAt,
    isMutable: false,
    ...(agentName != null ? { agentName } : {}),
  };
}

function mockListSessionsPage(sessions: Session[], nextPageToken?: string) {
  return {
    data: sessions,
    ...(nextPageToken != null ? { nextPageToken } : {}),
  };
}

function mockServer(partial: Partial<AgentChatServer>): AgentChatServer {
  return partial as AgentChatServer;
}

describe('createTrueForgeThreadListAdapter', () => {
  it('lists the first page without agentId when filter is omitted', async () => {
    const listSessions = vi
      .fn()
      .mockResolvedValue(
        mockListSessionsPage([mockSession('s1', 'First', '2026-06-30T10:00:00.000Z', 'my-agent')], 'page-2'),
      );
    const server = mockServer({ listSessions });
    const adapter = createTrueForgeThreadListAdapter({
      server,
      agentName: 'my-agent',
    });

    const result = await adapter.list();

    expect(listSessions).toHaveBeenCalledWith({
      createdByMe: false,
      limit: 20,
      startTimestamp: expect.any(String),
    });
    expect(result.threads).toEqual([
      {
        status: 'regular',
        remoteId: 's1',
        title: 'First',
        lastMessageAt: new Date('2026-06-30T10:00:00.000Z'),
        custom: { isMutable: false, agentName: 'my-agent' },
      },
    ]);
    expect(result.nextCursor).toBe('page-2');
  });

  it('forwards listSessionsAgentId as agentId', async () => {
    const listSessions = vi
      .fn()
      .mockResolvedValue(mockListSessionsPage([mockSession('s2', 'Second', '2026-06-29T10:00:00.000Z')]));
    const server = mockServer({ listSessions });
    const adapter = createTrueForgeThreadListAdapter({
      server,
      agentName: 'my-agent',
      listSessionsAgentId: 'filter-agent',
      listSessionsCreatedByMe: true,
    });

    const result = await adapter.list({ after: 'page-2' });

    expect(listSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: 'filter-agent',
        createdByMe: true,
        limit: 20,
        pageToken: 'page-2',
      }),
    );
    expect(result.nextCursor).toBeUndefined();
  });

  it('omits nextCursor when the backend returns no next page token', async () => {
    const listSessions = vi
      .fn()
      .mockResolvedValue(mockListSessionsPage([mockSession('s1', 'Only', '2026-06-30T10:00:00.000Z')]));
    const server = mockServer({ listSessions });
    const adapter = createTrueForgeThreadListAdapter({
      server,
      agentName: 'my-agent',
    });

    const result = await adapter.list();

    expect(result.nextCursor).toBeUndefined();
  });

  it('delete calls server.deleteSession when implemented', async () => {
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    const server = mockServer({ deleteSession });
    const adapter = createTrueForgeThreadListAdapter({
      server,
      agentName: 'my-agent',
    });

    await adapter.delete('s1');

    expect(deleteSession).toHaveBeenCalledWith({ sessionId: 's1' });
  });

  it('rename persists title when renameSession is present', async () => {
    const renameSession = vi.fn().mockResolvedValue(undefined);
    const server = mockServer({
      renameSession,
    });
    const adapter = createTrueForgeThreadListAdapter({
      server,
      agentName: 'my-agent',
    });

    await adapter.rename('s1', 'Acme onboarding');

    expect(renameSession).toHaveBeenCalledWith({
      sessionId: 's1',
      title: 'Acme onboarding',
    });
  });

  it('rename is a no-op when renameSession is omitted', async () => {
    const renameSession = vi.fn().mockResolvedValue(undefined);
    const adapter = createTrueForgeThreadListAdapter({
      server: mockServer({}),
      agentName: 'my-agent',
    });

    await expect(adapter.rename('s1', 'Acme onboarding')).resolves.toBeUndefined();
    expect(renameSession).not.toHaveBeenCalled();
  });

  it('delete is a no-op when server.deleteSession is missing', async () => {
    const adapter = createTrueForgeThreadListAdapter({
      server: mockServer({}),
      agentName: 'my-agent',
    });

    await expect(adapter.delete('s1')).resolves.toBeUndefined();
  });
});
