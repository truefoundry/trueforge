import { AssistantMessageStream } from 'assistant-stream';
import { describe, expect, it, vi } from 'vitest';

import { generateSessionTitleStream } from '../src/generateSessionTitleStream.js';
import type { AgentChatServer, Session } from '../src/server/index.js';

function mockSession(partial: Partial<Session> & Pick<Session, 'id'>): Session {
  return {
    title: null,
    updatedAt: '2026-06-30T10:00:00.000Z',
    createdAt: '2026-06-30T10:00:00.000Z',
    isMutable: false,
    ...partial,
  };
}

async function readStreamTitle(stream: Awaited<ReturnType<typeof generateSessionTitleStream>>) {
  let title: string | undefined;
  const messageStream = AssistantMessageStream.fromAssistantStream(stream);
  for await (const result of messageStream) {
    const textPart = result.parts.find(part => part.type === 'text');
    if (textPart != null && textPart.type === 'text') {
      title = textPart.text;
    }
  }
  return title;
}

describe('generateSessionTitleStream', () => {
  it('streams the trimmed session title from getSession', async () => {
    const getSession = vi.fn().mockResolvedValue(mockSession({ id: 'sess-1', title: '  Hello chat, how are you?  ' }));
    const renameSession = vi.fn();
    const server = { getSession, renameSession } as Pick<AgentChatServer, 'getSession'> & {
      renameSession: typeof renameSession;
    };

    const stream = await generateSessionTitleStream(server, 'sess-1');

    expect(getSession).toHaveBeenCalledWith({ sessionId: 'sess-1' });
    expect(renameSession).not.toHaveBeenCalled();
    expect(await readStreamTitle(stream)).toBe('Hello chat, how are you?');
  });

  it('returns an empty stream when the session title is blank', async () => {
    const getSession = vi.fn().mockResolvedValue(mockSession({ id: 'sess-1', title: '   ' }));
    const stream = await generateSessionTitleStream({ getSession }, 'sess-1');

    expect(await readStreamTitle(stream)).toBeUndefined();
  });

  it('returns an empty stream when getSession fails', async () => {
    const getSession = vi.fn().mockRejectedValue(new Error('offline'));
    const stream = await generateSessionTitleStream({ getSession }, 'sess-1');

    expect(await readStreamTitle(stream)).toBeUndefined();
  });
});
