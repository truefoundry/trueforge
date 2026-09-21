import { describe, expect, it, vi } from 'vitest';

import type { AgentChatServer, Session } from '../src/server/index.js';

import { createTrueForgeOwnedSessionsThreadListAdapter } from '../src/trueforgeOwnedSessionsThreadListAdapter.js';

function mockNamedSession(id: string, title: string, updatedAt: string): Session {
  return {
    id,
    agentName: 'my-agent',
    title,
    createdAt: updatedAt,
    updatedAt,
    isMutable: false,
  };
}

function mockDraftSession(id: string, title: string | undefined, updatedAt: string): Session {
  return {
    id,
    agentSpec: { model: { name: 'anthropic/claude-sonnet-4-6' } },
    ...(title === undefined ? {} : { title }),
    createdAt: updatedAt,
    updatedAt,
    isMutable: true,
  };
}

function mockServer(partial: Partial<AgentChatServer>): AgentChatServer {
  return partial as AgentChatServer;
}

describe('createTrueForgeOwnedSessionsThreadListAdapter', () => {
  it('lists owned sessions (named + draft) with pagination cursor', async () => {
    const listSessions = vi.fn().mockResolvedValue({
      data: [
        mockNamedSession('s1', 'Named chat', '2026-06-30T12:00:00.000Z'),
        mockDraftSession('d1', 'Draft chat', '2026-06-30T11:00:00.000Z'),
      ],
      nextPageToken: 'page-2',
    });
    const server = mockServer({ listSessions, getSession: vi.fn() });

    const adapter = createTrueForgeOwnedSessionsThreadListAdapter({ server });
    const result = await adapter.list();

    expect(listSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByMe: false,
        limit: 20,
        startTimestamp: expect.any(String),
      }),
    );
    expect(result.threads).toEqual([
      {
        status: 'regular',
        remoteId: 's1',
        title: 'Named chat',
        lastMessageAt: new Date('2026-06-30T12:00:00.000Z'),
        custom: { isMutable: false, agentName: 'my-agent' },
      },
      {
        status: 'regular',
        remoteId: 'd1',
        title: 'Draft chat',
        lastMessageAt: new Date('2026-06-30T11:00:00.000Z'),
        custom: { isMutable: true },
      },
    ]);
    expect(result.nextCursor).toBe('page-2');
  });

  it('forwards listSessionsAgentId as agentId', async () => {
    const listSessions = vi.fn().mockResolvedValue({ data: [] });
    const server = mockServer({ listSessions, getSession: vi.fn() });

    const adapter = createTrueForgeOwnedSessionsThreadListAdapter({
      server,
      listSessionsAgentId: 'agent-x',
      listSessionsCreatedByMe: true,
    });
    await adapter.list();

    expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-x', createdByMe: true }));
  });

  it('falls back to model name for untitled drafts', async () => {
    const listSessions = vi.fn().mockResolvedValue({
      data: [mockDraftSession('d1', undefined, '2026-06-30T11:00:00.000Z')],
    });
    const server = mockServer({ listSessions, getSession: vi.fn() });

    const adapter = createTrueForgeOwnedSessionsThreadListAdapter({ server });
    const result = await adapter.list();

    expect(result.threads[0]?.title).toBe('anthropic/claude-sonnet-4-6');
  });

  it('rename persists title when renameSession is present', async () => {
    const renameSession = vi.fn().mockResolvedValue(undefined);
    const adapter = createTrueForgeOwnedSessionsThreadListAdapter({
      server: mockServer({
        renameSession,
        listSessions: vi.fn(),
        getSession: vi.fn(),
      }),
    });

    await adapter.rename('s1', 'Customer A');

    expect(renameSession).toHaveBeenCalledWith({
      sessionId: 's1',
      title: 'Customer A',
    });
  });

  it('rename is a no-op when renameSession is omitted', async () => {
    const renameSession = vi.fn().mockResolvedValue(undefined);
    const adapter = createTrueForgeOwnedSessionsThreadListAdapter({
      server: mockServer({
        listSessions: vi.fn(),
        getSession: vi.fn(),
      }),
    });

    await expect(adapter.rename('s1', 'Customer A')).resolves.toBeUndefined();
    expect(renameSession).not.toHaveBeenCalled();
  });

  it('throws on initialize because the adapter is read-only', async () => {
    const server = mockServer({
      listSessions: vi.fn(),
      getSession: vi.fn(),
    });

    const adapter = createTrueForgeOwnedSessionsThreadListAdapter({ server });

    await expect(adapter.initialize('local')).rejects.toThrow(/read-only/);
  });
});
