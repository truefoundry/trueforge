import { describe, expect, it, vi } from 'vitest';

import type { AgentChatServer, Session } from '../../src/server/index.js';

import { createTrueForgeDraftThreadListAdapter } from '../../src/draft/trueforgeDraftThreadListAdapter.js';
import type { AgentSpec } from '../../src/server/types.js';

const defaultAgentSpec: AgentSpec = {
  model: { name: 'anthropic/claude-sonnet-4-6' },
  instructions: 'You are helpful.',
};

function mockDraft(id: string, title: string | undefined, updatedAt: string, extras?: Partial<Session>): Session {
  return {
    id,
    agentSpec: defaultAgentSpec,
    ...(title === undefined ? {} : { title }),
    createdAt: updatedAt,
    updatedAt,
    isMutable: true,
    ...extras,
  };
}

function mockNamed(id: string, title: string | undefined, updatedAt: string, agentName: string): Session {
  return {
    id,
    ...(title === undefined ? {} : { title }),
    agentName,
    createdAt: updatedAt,
    updatedAt,
    isMutable: false,
  };
}

function mockDraftListPage(drafts: Session[], nextPageToken?: string) {
  return {
    data: drafts,
    ...(nextPageToken != null ? { nextPageToken } : {}),
  };
}

function mockServer(partial: Partial<AgentChatServer>): AgentChatServer {
  return partial as AgentChatServer;
}

describe('createTrueForgeDraftThreadListAdapter', () => {
  it('lists sessions with pagination cursor and does not filter isMutable client-side', async () => {
    const listSessions = vi
      .fn()
      .mockResolvedValue(
        mockDraftListPage(
          [
            mockDraft('d1', 'My draft', '2026-06-30T10:00:00.000Z'),
            mockNamed('s1', 'Named', '2026-06-30T09:00:00.000Z', 'from-sdk'),
            mockNamed('s2', undefined, '2026-06-30T08:00:00.000Z', 'untitled-agent'),
          ],
          'page-2',
        ),
      );
    const server = mockServer({
      listSessions,
      createSession: vi.fn(),
      getSession: vi.fn(),
    });

    const adapter = createTrueForgeDraftThreadListAdapter({
      server,
      defaultAgentSpec,
    });

    const result = await adapter.list();

    expect(listSessions).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByMe: false,
        limit: 20,
        startTimestamp: expect.any(String),
      }),
    );
    expect(listSessions).toHaveBeenCalledWith(expect.not.objectContaining({ agentId: expect.anything() }));
    expect(result.threads).toEqual([
      {
        status: 'regular',
        remoteId: 'd1',
        title: 'My draft',
        lastMessageAt: new Date('2026-06-30T10:00:00.000Z'),
        custom: { isMutable: true },
      },
      {
        status: 'regular',
        remoteId: 's1',
        title: 'Named',
        lastMessageAt: new Date('2026-06-30T09:00:00.000Z'),
        custom: { isMutable: false, agentName: 'from-sdk' },
      },
      {
        status: 'regular',
        remoteId: 's2',
        title: 'untitled-agent',
        lastMessageAt: new Date('2026-06-30T08:00:00.000Z'),
        custom: { isMutable: false, agentName: 'untitled-agent' },
      },
    ]);
    expect(result.nextCursor).toBe('page-2');
  });

  it('forwards listSessionsAgentId as agentId', async () => {
    const listSessions = vi.fn().mockResolvedValue(mockDraftListPage([]));
    const server = mockServer({
      listSessions,
      createSession: vi.fn(),
      getSession: vi.fn(),
    });

    const adapter = createTrueForgeDraftThreadListAdapter({
      server,
      defaultAgentSpec,
      listSessionsAgentId: 'agent-x',
      listSessionsCreatedByMe: true,
    });

    await adapter.list();

    expect(listSessions).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'agent-x', createdByMe: true }));
  });

  it('creates a draft session on initialize', async () => {
    const createSession = vi.fn().mockResolvedValue(mockDraft('d-new', undefined, '2026-06-30T12:00:00.000Z'));
    const server = mockServer({
      listSessions: vi.fn(),
      createSession,
      getSession: vi.fn(),
    });

    const adapter = createTrueForgeDraftThreadListAdapter({
      server,
      defaultAgentSpec,
    });

    const result = await adapter.initialize('local-thread-id');

    expect(createSession).toHaveBeenCalledWith({ agentSpec: defaultAgentSpec });
    expect(result).toEqual({ remoteId: 'd-new', externalId: undefined });
  });

  it('creates a draft session with the live agent spec when getAgentSpec is provided', async () => {
    const liveAgentSpec: AgentSpec = {
      model: { name: 'anthropic/claude-opus-4-8' },
      instructions: 'You are helpful.',
      mcpServers: [{ id: 'github', name: 'github' }],
      skills: [{ id: 'skill-a', name: 'skill-a' }],
    };
    const createSession = vi.fn().mockResolvedValue(mockDraft('d-new', undefined, '2026-06-30T12:00:00.000Z'));
    const server = mockServer({
      listSessions: vi.fn(),
      createSession,
      getSession: vi.fn(),
    });

    const adapter = createTrueForgeDraftThreadListAdapter({
      server,
      defaultAgentSpec,
      getAgentSpec: () => liveAgentSpec,
    });

    await adapter.initialize('local-thread-id');

    expect(createSession).toHaveBeenCalledWith({ agentSpec: liveAgentSpec });
  });

  it('rename persists title when renameSession is present', async () => {
    const renameSession = vi.fn().mockResolvedValue(undefined);
    const adapter = createTrueForgeDraftThreadListAdapter({
      server: mockServer({
        renameSession,
        listSessions: vi.fn(),
        createSession: vi.fn(),
        getSession: vi.fn(),
      }),
      defaultAgentSpec,
    });

    await adapter.rename('d1', 'Renamed draft');

    expect(renameSession).toHaveBeenCalledWith({
      sessionId: 'd1',
      title: 'Renamed draft',
    });
  });

  it('rename is a no-op when renameSession is omitted', async () => {
    const renameSession = vi.fn().mockResolvedValue(undefined);
    const adapter = createTrueForgeDraftThreadListAdapter({
      server: mockServer({
        listSessions: vi.fn(),
        createSession: vi.fn(),
        getSession: vi.fn(),
      }),
      defaultAgentSpec,
    });

    await expect(adapter.rename('d1', 'Renamed draft')).resolves.toBeUndefined();
    expect(renameSession).not.toHaveBeenCalled();
  });

  it('falls back to model name for title when draft has no title', async () => {
    const getSession = vi.fn().mockResolvedValue(mockDraft('d1', undefined, '2026-06-30T10:00:00.000Z'));
    const server = mockServer({
      listSessions: vi.fn(),
      createSession: vi.fn(),
      getSession,
    });

    const adapter = createTrueForgeDraftThreadListAdapter({
      server,
      defaultAgentSpec,
    });

    const result = await adapter.fetch('d1');

    expect(getSession).toHaveBeenCalledWith({ sessionId: 'd1' });
    expect(result.title).toBe('anthropic/claude-sonnet-4-6');
  });
});
