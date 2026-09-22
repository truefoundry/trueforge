import { describe, expect, it, vi } from 'vitest';
import type { AgentChatServer, TurnStreamData } from '../src/server/index.js';

import { ROOT_THREAD_ID } from '../src/constants.js';
import { PeerThreadFoldState } from '../src/foldPeerThreads.js';
import { resumeTurnStream, streamTurnContent } from '../src/streamTurn.js';

const createdAt = new Date().toISOString();
const SESSION_ID = 'session-1';

function streamData(sequenceNumber: number, event: TurnStreamData['event'] | Record<string, unknown>): TurnStreamData {
  return { sequenceNumber, event: event as TurnStreamData['event'] };
}

function mockServer(partial: Record<string, unknown>): AgentChatServer {
  return partial as unknown as AgentChatServer;
}

async function collectUpdates(generator: AsyncGenerator<{ content: unknown[] }>): Promise<{ content: unknown[] }[]> {
  const updates: { content: unknown[] }[] = [];
  for await (const update of generator) {
    updates.push(update);
  }
  return updates;
}

describe('streamTurn', () => {
  describe('streamTurnContent', () => {
    it('prepares a user turn and yields folded stream updates', async () => {
      const foldState = new PeerThreadFoldState();
      const createTurn = vi.fn(async function* () {
        yield streamData(1, {
          type: 'model.message',
          createdAt,
          id: 'm1',
          threadId: ROOT_THREAD_ID,
          content: 'hello from stream',
        });
      });
      const server = mockServer({
        createTurn,
        cancelSession: vi.fn().mockResolvedValue(undefined),
      });

      const updates = await collectUpdates(
        streamTurnContent(server, SESSION_ID, foldState, { userMessage: 'hello' }, new AbortController().signal),
      );

      expect(createTurn).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        input: [{ type: 'user.message', content: 'hello' }],
        previousTurnId: 'auto',
        abortSignal: expect.any(AbortSignal),
      });
      expect(updates).toEqual([{ content: [{ type: 'text', text: 'hello from stream' }] }]);
    });

    it('passes required-action inputs through createTurn', async () => {
      const inputs = [
        {
          type: 'user.tool_approval' as const,
          threadId: ROOT_THREAD_ID,
          toolCallId: 'approval-1',
          approval: { status: 'allow' as const },
        },
        {
          type: 'user.tool_response' as const,
          threadId: ROOT_THREAD_ID,
          toolCallId: 'question-1',
          content: 'A',
        },
      ];
      const createTurn = vi.fn(async function* () {});
      const server = mockServer({
        createTurn,
        cancelSession: vi.fn().mockResolvedValue(undefined),
      });

      await collectUpdates(
        streamTurnContent(server, SESSION_ID, new PeerThreadFoldState(), { inputs }, new AbortController().signal),
      );

      expect(createTurn).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        input: inputs,
        previousTurnId: 'auto',
        abortSignal: expect.any(AbortSignal),
      });
    });

    it('uses empty input when resuming after MCP auth', async () => {
      const createTurn = vi.fn(async function* () {});
      const server = mockServer({
        createTurn,
        cancelSession: vi.fn().mockResolvedValue(undefined),
      });

      await collectUpdates(
        streamTurnContent(
          server,
          SESSION_ID,
          new PeerThreadFoldState(),
          { resumeMcpAuth: true },
          new AbortController().signal,
        ),
      );

      expect(createTurn).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        input: [],
        previousTurnId: 'auto',
        abortSignal: expect.any(AbortSignal),
      });
    });

    it('forwards an explicit previousTurnId when branching', async () => {
      const createTurn = vi.fn(async function* () {});
      const server = mockServer({
        createTurn,
        cancelSession: vi.fn().mockResolvedValue(undefined),
      });

      await collectUpdates(
        streamTurnContent(
          server,
          SESSION_ID,
          new PeerThreadFoldState(),
          { userMessage: 'edited', previousTurnId: 'turn-a' },
          new AbortController().signal,
        ),
      );

      expect(createTurn).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        input: [{ type: 'user.message', content: 'edited' }],
        previousTurnId: 'turn-a',
        abortSignal: expect.any(AbortSignal),
      });
    });

    it('forwards previousTurnId "none" when branching from root', async () => {
      const createTurn = vi.fn(async function* () {});
      const server = mockServer({
        createTurn,
        cancelSession: vi.fn().mockResolvedValue(undefined),
      });

      await collectUpdates(
        streamTurnContent(
          server,
          SESSION_ID,
          new PeerThreadFoldState(),
          { userMessage: 'first', previousTurnId: 'none' },
          new AbortController().signal,
        ),
      );

      expect(createTurn).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        input: [{ type: 'user.message', content: 'first' }],
        previousTurnId: 'none',
        abortSignal: expect.any(AbortSignal),
      });
    });

    it('returns early without cancelling the backend run when already aborted', async () => {
      const createTurn = vi.fn(async function* () {});
      const cancelSession = vi.fn().mockResolvedValue(undefined);
      const server = mockServer({ createTurn, cancelSession });
      const abortController = new AbortController();
      abortController.abort();

      const updates = await collectUpdates(
        streamTurnContent(
          server,
          SESSION_ID,
          new PeerThreadFoldState(),
          { userMessage: 'hello' },
          abortController.signal,
        ),
      );

      expect(cancelSession).not.toHaveBeenCalled();
      expect(createTurn).not.toHaveBeenCalled();
      expect(updates).toEqual([]);
    });

    it('does not cancel the backend run when the stream is aborted mid-flight', async () => {
      const abortController = new AbortController();
      const createTurn = vi.fn(async function* () {
        yield streamData(1, {
          type: 'model.message',
          createdAt,
          id: 'm1',
          threadId: ROOT_THREAD_ID,
          content: 'partial',
        });
        abortController.abort();
      });
      const cancelSession = vi.fn().mockResolvedValue(undefined);
      const server = mockServer({ createTurn, cancelSession });

      await collectUpdates(
        streamTurnContent(
          server,
          SESSION_ID,
          new PeerThreadFoldState(),
          { userMessage: 'hello' },
          abortController.signal,
        ),
      );

      expect(cancelSession).not.toHaveBeenCalled();
    });

    it('forwards headers to createTurn', async () => {
      const createTurn = vi.fn(async function* () {});
      const server = mockServer({
        createTurn,
        cancelSession: vi.fn().mockResolvedValue(undefined),
      });
      const abortSignal = new AbortController().signal;

      await collectUpdates(
        streamTurnContent(
          server,
          SESSION_ID,
          new PeerThreadFoldState(),
          {
            userMessage: 'hello',
            headers: {
              'x-tfy-session-last-updated-at': '2026-06-30T10:00:00.000Z',
            },
          },
          abortSignal,
        ),
      );

      expect(createTurn).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        input: [{ type: 'user.message', content: 'hello' }],
        previousTurnId: 'auto',
        abortSignal,
        headers: {
          'x-tfy-session-last-updated-at': '2026-06-30T10:00:00.000Z',
        },
      });
    });

    it('notifies gateway turn id when turn.done errors with no content yields', async () => {
      const gatewayTurnId = '01ky6mqzmczwt6ssyd5r02gjjc';
      const createTurn = vi.fn(async function* () {
        yield streamData(1, {
          type: 'turn.created',
          createdAt,
          id: 'created-1',
          turnId: gatewayTurnId,
          input: [{ type: 'user.message', content: 'hello' }],
        });
        yield streamData(2, {
          type: 'turn.done',
          createdAt,
          id: 'done-1',
          state: {
            status: 'error',
            message: 'Publisher Model is not servable in region us-central1.',
            completedAt: createdAt,
          },
        });
      });
      const server = mockServer({
        createTurn,
        cancelSession: vi.fn().mockResolvedValue(undefined),
      });
      const onTurnIdAvailable = vi.fn();

      await expect(
        collectUpdates(
          streamTurnContent(
            server,
            SESSION_ID,
            new PeerThreadFoldState(),
            { userMessage: 'hello' },
            new AbortController().signal,
            undefined,
            onTurnIdAvailable,
          ),
        ),
      ).rejects.toThrow('Publisher Model is not servable in region us-central1.');

      expect(onTurnIdAvailable).toHaveBeenCalledTimes(1);
      expect(onTurnIdAvailable).toHaveBeenCalledWith(gatewayTurnId);
    });

    it('does not notify when an error stream never emits turn.created', async () => {
      const createTurn = vi.fn(async function* () {
        yield streamData(1, {
          type: 'turn.done',
          createdAt,
          id: 'done-1',
          state: {
            status: 'error',
            completedAt: createdAt,
            message: 'boom',
          },
        });
      });
      const server = mockServer({
        createTurn,
        cancelSession: vi.fn().mockResolvedValue(undefined),
      });
      const onTurnIdAvailable = vi.fn();

      await expect(
        collectUpdates(
          streamTurnContent(
            server,
            SESSION_ID,
            new PeerThreadFoldState(),
            { userMessage: 'hello' },
            new AbortController().signal,
            undefined,
            onTurnIdAvailable,
          ),
        ),
      ).rejects.toThrow('boom');

      expect(onTurnIdAvailable).not.toHaveBeenCalled();
    });
  });

  describe('resumeTurnStream', () => {
    it('reconnects with afterSequenceNumber and yields updates', async () => {
      const foldState = new PeerThreadFoldState();
      const subscribeToTurn = vi.fn(async function* () {
        yield streamData(2, {
          type: 'model.message',
          createdAt,
          id: 'm2',
          threadId: ROOT_THREAD_ID,
          content: 'resumed',
        });
      });
      const server = mockServer({
        subscribeToTurn,
        cancelSession: vi.fn().mockResolvedValue(undefined),
      });

      const updates = await collectUpdates(
        resumeTurnStream(server, SESSION_ID, 'turn-1', foldState, new AbortController().signal, 1),
      );
      expect(subscribeToTurn).toHaveBeenCalledWith({
        sessionId: SESSION_ID,
        turnId: 'turn-1',
        afterSequenceNumber: 1,
        abortSignal: expect.any(AbortSignal),
      });
      expect(updates).toEqual([{ content: [{ type: 'text', text: 'resumed' }] }]);
    });

    it('yields nothing when the server omits subscribeToTurn', async () => {
      const cancelSession = vi.fn().mockResolvedValue(undefined);
      const server = mockServer({ cancelSession });

      const updates = await collectUpdates(
        resumeTurnStream(server, SESSION_ID, 'turn-1', new PeerThreadFoldState(), new AbortController().signal),
      );

      expect(updates).toEqual([]);
      expect(cancelSession).not.toHaveBeenCalled();
    });

    it('returns early when aborted before streaming starts', async () => {
      const subscribeToTurn = vi.fn(async function* () {});
      const cancelSession = vi.fn().mockResolvedValue(undefined);
      const server = mockServer({ subscribeToTurn, cancelSession });
      const abortController = new AbortController();
      abortController.abort();

      const updates = await collectUpdates(
        resumeTurnStream(server, SESSION_ID, 'turn-1', new PeerThreadFoldState(), abortController.signal),
      );

      expect(cancelSession).not.toHaveBeenCalled();
      expect(subscribeToTurn).not.toHaveBeenCalled();
      expect(updates).toEqual([]);
    });
  });
});
