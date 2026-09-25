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
      expect(updates).toEqual([{ content: [{ type: 'text', text: 'hello from stream' }], sequenceNumber: 1 }]);
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

      const updates = await collectUpdates(
        streamTurnContent(
          server,
          SESSION_ID,
          new PeerThreadFoldState(),
          { userMessage: 'hello' },
          new AbortController().signal,
          undefined,
          onTurnIdAvailable,
        ),
      );

      expect(onTurnIdAvailable).toHaveBeenCalledTimes(1);
      expect(onTurnIdAvailable).toHaveBeenCalledWith(gatewayTurnId);
      expect(updates.at(-1)).toMatchObject({
        status: {
          type: 'incomplete',
          reason: 'error',
          error: 'Publisher Model is not servable in region us-central1.',
        },
      });
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

      const updates = await collectUpdates(
        streamTurnContent(
          server,
          SESSION_ID,
          new PeerThreadFoldState(),
          { userMessage: 'hello' },
          new AbortController().signal,
          undefined,
          onTurnIdAvailable,
        ),
      );

      expect(onTurnIdAvailable).not.toHaveBeenCalled();
      expect(updates.at(-1)).toMatchObject({
        status: { type: 'incomplete', reason: 'error', error: 'boom' },
      });
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
      expect(updates).toEqual([{ content: [{ type: 'text', text: 'resumed' }], sequenceNumber: 2 }]);
    });

    it('ends a stream segment at paused without terminalizing the turn', async () => {
      const subscribeToTurn = vi.fn(async function* () {
        yield streamData(2, {
          type: 'model.message',
          createdAt,
          id: 'm2',
          threadId: ROOT_THREAD_ID,
          toolCalls: [
            {
              id: 'approval-1',
              type: 'function',
              function: { name: 'bash', arguments: '{}' },
            },
          ],
        });
        yield streamData(3, {
          type: 'tool.approval_required',
          id: 'approval-required-1',
          createdAt,
          threadId: ROOT_THREAD_ID,
          toolCalls: [{ id: 'approval-1', sourceEventId: 'm2' }],
        });
        yield streamData(4, {
          type: 'turn.update',
          id: 'pause-1',
          createdAt,
          threadId: null,
          state: {
            status: 'paused',
            actionRequiredOnEvents: [{ id: 'approval-required-1' }],
          },
        });
      });
      const server = mockServer({ subscribeToTurn });

      const updates = await collectUpdates(
        resumeTurnStream(server, SESSION_ID, 'turn-1', new PeerThreadFoldState(), new AbortController().signal, 1),
      );

      expect(updates.at(-1)).toMatchObject({
        sequenceNumber: 4,
        status: { type: 'requires-action', reason: 'tool-calls' },
        turnState: {
          status: 'paused',
          actionRequiredOnEvents: [{ id: 'approval-required-1' }],
        },
      });
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
