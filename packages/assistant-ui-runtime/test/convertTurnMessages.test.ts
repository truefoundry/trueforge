import type { AppendMessage } from '@assistant-ui/core';
import { describe, expect, it, vi } from 'vitest';
import type {
  AgentChatServer,
  ModelMessageEvent,
  SandboxCreatedEvent,
  SessionEventItem,
  ThreadCreatedEvent,
  ToolApprovalRequiredEvent,
  ToolResponseRequiredEvent,
  Turn,
  TurnDoneEvent,
  TurnEvent,
  TurnStreamData,
} from '../src/server/index.js';

import { collectPendingApprovals, collectPendingToolResponses, derivePendingMcpAuth } from '../src/collectPending.js';
import { ROOT_THREAD_ID } from '../src/constants.js';
import {
  buildSnapshotFromSessionEvents,
  buildSnapshotThroughTurn,
  buildTurnAssistantContent,
  buildUserMessageContent,
  buildUserMessageFromTurnInput,
  convertTurnsToThreadMessages,
  getTurnMessageContent,
  prependOlderSessionHistory,
  projectSessionMessages,
  repositoryItemsFromMessages,
  resolveGatewayBranchPreviousTurnIdForTurn,
  streamTurnEvents,
  turnStreamUpdateToAssistantMessage,
} from '../src/convertTurnMessages.js';
import { buildRootAssistantContent, ingestTurnEvent, PeerThreadFoldState } from '../src/foldPeerThreads.js';
import { MESSAGE_CUSTOM_KEY } from '../src/messageCustomMetadata.js';
import { findPausedAssistantMessage } from '../src/requiredActionInputs.js';
import { createEmptySessionSnapshot, replaceSessionSnapshot, turnToSessionRecord } from '../src/sessionSnapshot.js';
import { applyUserToolResponsesToFold, toolResponseStatus } from '../src/toolResponse.js';
import type { TurnStreamUpdate } from '../src/turnStreamUpdate.js';

const createdAt = new Date().toISOString();
const SESSION_ID = 'session-1';

type TurnFixture = Turn & { events: TurnEvent[] };

function modelMessage(event: Omit<ModelMessageEvent, 'type' | 'createdAt'>): ModelMessageEvent {
  return { type: 'model.message', createdAt, ...event };
}

function approvalRequired(event: Omit<ToolApprovalRequiredEvent, 'type' | 'createdAt'>): ToolApprovalRequiredEvent {
  return { type: 'tool.approval_required', createdAt, ...event };
}

function threadCreated(event: Omit<ThreadCreatedEvent, 'type' | 'createdAt'>): ThreadCreatedEvent {
  return { type: 'thread.created', createdAt, ...event };
}

function sandboxCreated(event: { id: string; sandboxId: string; threadId?: string | null }): SandboxCreatedEvent {
  return {
    type: 'sandbox.created',
    createdAt,
    threadId: event.threadId ?? null,
    id: event.id,
    sandboxId: event.sandboxId,
  };
}

function responseRequired(event: Omit<ToolResponseRequiredEvent, 'type' | 'createdAt'>): ToolResponseRequiredEvent {
  return { type: 'tool.response_required', createdAt, ...event };
}

async function* streamFrom(events: TurnStreamData['event'][]): AsyncGenerator<TurnStreamData> {
  for (const [index, event] of events.entries()) {
    yield { sequenceNumber: index + 1, event };
  }
}

function appendUserMessage(
  content: AppendMessage['content'],
  attachments: AppendMessage['attachments'] = [],
): AppendMessage {
  return {
    role: 'user',
    content,
    attachments,
    createdAt: new Date(),
    metadata: { custom: {} },
    parentId: null,
    sourceId: null,
    runConfig: undefined,
  };
}

function mockTurn(
  overrides: Partial<Turn> &
    Pick<Turn, 'id' | 'createdAt'> & {
      events?: TurnEvent[];
    },
): TurnFixture {
  const {
    events = [
      modelMessage({
        id: 'm1',
        threadId: ROOT_THREAD_ID,
        content: 'assistant reply',
      }),
    ],
    ...rest
  } = overrides;
  return {
    sessionId: SESSION_ID,
    input: [{ type: 'user.message', content: 'hello' }],
    state: { status: 'done', requiredActions: [], completedAt: createdAt },
    ...rest,
    events,
  };
}

/** Mirror runtime listTurns normalization: ASC stays, DESC (or tied) reverses. */
function toOldestFirstTurns(turns: TurnFixture[]): TurnFixture[] {
  const chain = turns.filter(turn => turn.state.status !== 'running');
  let newestFirst = chain.length > 1;
  for (let i = 1; i < chain.length; i++) {
    const newer = chain[i];
    const older = chain[i - 1];
    if (newer == null || older == null) {
      continue;
    }
    const delta = Date.parse(newer.createdAt) - Date.parse(older.createdAt);
    if (delta < 0) {
      newestFirst = true;
      break;
    }
    if (delta > 0) {
      newestFirst = false;
      break;
    }
  }
  return newestFirst ? [...chain].reverse() : [...chain];
}

/** Mirrors the host's ancestor walk: parent pointers only, sibling branches excluded. */
function ancestorChainFromTurns(turns: TurnFixture[], anchorTurnId: string): TurnFixture[] {
  const turnsById = new Map(turns.map(turn => [turn.id, turn]));
  const chain: TurnFixture[] = [];
  const seen = new Set<string>();
  let cursor: string | null | undefined = anchorTurnId;
  while (cursor != null && !seen.has(cursor)) {
    seen.add(cursor);
    const turn = turnsById.get(cursor);
    if (turn == null) {
      break;
    }
    if (turn.state.status !== 'running') {
      chain.unshift(turn);
    }
    cursor = turn.previousTurnId;
  }
  return chain;
}

/**
 * Builds session-level event items from per-turn mocks — accepts ASC or DESC
 * listTurns order; running turns excluded (matches session.listEvents). An
 * anchor selects that turn's ancestor chain, not a chronological prefix.
 */
function sessionEventItemsFromTurns(turns: TurnFixture[], lastTurnId?: string): SessionEventItem[] {
  const chain = lastTurnId == null ? toOldestFirstTurns(turns) : ancestorChainFromTurns(turns, lastTurnId);

  const items: SessionEventItem[] = [];
  for (const turn of chain) {
    items.push({
      turnId: turn.id,
      event: {
        type: 'turn.created',
        id: `created-${turn.id}`,
        turnId: turn.id,
        ...(turn.input === undefined ? {} : { input: turn.input }),
        state: { status: 'running' },
        createdAt: turn.createdAt,
        ...(turn.previousTurnId === undefined ? {} : { previousTurnId: turn.previousTurnId }),
      },
    });
    for (const event of turn.events) {
      items.push({ turnId: turn.id, event });
    }
    items.push({
      turnId: turn.id,
      event: {
        type: 'turn.done',
        id: `done-${turn.id}`,
        state: turn.state as TurnDoneEvent['state'],
        createdAt: turn.createdAt,
      },
    });
  }
  return items;
}

function mockServerWithTurns(turns: TurnFixture[]): AgentChatServer {
  const eventsByTurnId = new Map(turns.map(turn => [turn.id, turn.events]));
  const turnsById = new Map(turns.map(turn => [turn.id, turn]));
  return {
    listTurns: async ({ limit }: { limit?: number } = {}) => ({
      data: limit != null ? turns.slice(0, limit) : turns,
    }),
    getTurn: async ({ turnId }: { turnId: string }) => {
      const turn = turnsById.get(turnId);
      if (turn == null) {
        throw new Error(`Turn ${turnId} not found`);
      }
      return turn;
    },
    listEvents: async (opts: { lastTurnId?: string } = {}) => {
      const items = sessionEventItemsFromTurns(turns, opts.lastTurnId);
      const newestFirst = [...items].reverse();
      return { data: newestFirst };
    },
    listTurnEvents: async ({ turnId }: { turnId: string }) => ({
      data: eventsByTurnId.get(turnId) ?? [],
    }),
  } as unknown as AgentChatServer;
}

async function collectStream<T>(stream: AsyncGenerator<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of stream) {
    items.push(item);
  }
  return items;
}

describe('convertTurnMessages', () => {
  describe('getTurnMessageContent', () => {
    it('joins text parts from append message content', () => {
      expect(
        getTurnMessageContent(
          appendUserMessage([
            { type: 'text', text: 'line one' },
            { type: 'text', text: 'line two' },
          ]),
        ),
      ).toBe('line one\nline two');
    });

    it('throws when no text content is present', () => {
      expect(() => getTurnMessageContent(appendUserMessage([]))).toThrow('User message must contain text content.');
    });
  });

  describe('buildUserMessageContent', () => {
    it('returns a bare string for text-only messages', () => {
      expect(buildUserMessageContent(appendUserMessage([{ type: 'text', text: 'hello there' }]))).toBe('hello there');
    });

    it('forwards file attachments as gateway file parts', () => {
      expect(
        buildUserMessageContent(
          appendUserMessage(
            [{ type: 'text', text: 'see attached' }],
            [
              {
                id: 'att-1',
                type: 'file',
                name: 'doc.pdf',
                contentType: 'application/pdf',
                status: { type: 'complete' },
                content: [
                  {
                    type: 'file',
                    mimeType: 'application/pdf',
                    data: 'JVBERi0xLjQK',
                  },
                ],
              },
            ],
          ),
        ),
      ).toEqual([
        { type: 'text', text: 'see attached' },
        {
          type: 'file',
          name: 'doc.pdf',
          data: 'data:application/pdf;base64,JVBERi0xLjQK',
        },
      ]);
    });

    it('forwards attachments without requiring text', () => {
      expect(
        buildUserMessageContent(
          appendUserMessage(
            [],
            [
              {
                id: 'att-1',
                type: 'file',
                name: 'doc.pdf',
                contentType: 'application/pdf',
                status: { type: 'complete' },
                content: [
                  {
                    type: 'file',
                    mimeType: 'application/pdf',
                    data: 'JVBERi0xLjQK',
                  },
                ],
              },
            ],
          ),
        ),
      ).toEqual([
        {
          type: 'file',
          name: 'doc.pdf',
          data: 'data:application/pdf;base64,JVBERi0xLjQK',
        },
      ]);
    });

    it('passes through data URIs unchanged', () => {
      const dataUri = 'data:application/pdf;base64,JVBERi0xLjQK';
      expect(
        buildUserMessageContent(
          appendUserMessage(
            [{ type: 'text', text: 'file' }],
            [
              {
                id: 'att-1',
                type: 'file',
                name: 'doc.pdf',
                contentType: 'application/pdf',
                status: { type: 'complete' },
                content: [
                  {
                    type: 'file',
                    mimeType: 'application/pdf',
                    data: dataUri,
                  },
                ],
              },
            ],
          ),
        ),
      ).toEqual([
        { type: 'text', text: 'file' },
        {
          type: 'file',
          name: 'doc.pdf',
          data: dataUri,
        },
      ]);
    });

    it('maps image parts to gateway file parts', () => {
      expect(
        buildUserMessageContent(
          appendUserMessage(
            [{ type: 'text', text: 'image' }],
            [
              {
                id: 'att-1',
                type: 'image',
                name: 'photo.png',
                contentType: 'image/png',
                status: { type: 'complete' },
                content: [
                  {
                    type: 'image',
                    image: 'data:image/png;base64,AAAA',
                  },
                ],
              },
            ],
          ),
        ),
      ).toEqual([
        { type: 'text', text: 'image' },
        {
          type: 'file',
          name: 'photo.png',
          data: 'data:image/png;base64,AAAA',
        },
      ]);
    });

    it('includes file parts from message content and attachments', () => {
      expect(
        buildUserMessageContent(
          appendUserMessage(
            [
              { type: 'text', text: 'inline' },
              {
                type: 'file',
                mimeType: 'application/pdf',
                data: 'AAAA',
                filename: 'inline.pdf',
              },
            ],
            [
              {
                id: 'att-1',
                type: 'file',
                name: 'attached.pdf',
                contentType: 'application/pdf',
                status: { type: 'complete' },
                content: [
                  {
                    type: 'file',
                    mimeType: 'application/pdf',
                    data: 'BBBB',
                  },
                ],
              },
            ],
          ),
        ),
      ).toEqual([
        { type: 'text', text: 'inline' },
        {
          type: 'file',
          name: 'inline.pdf',
          data: 'data:application/pdf;base64,AAAA',
        },
        {
          type: 'file',
          name: 'attached.pdf',
          data: 'data:application/pdf;base64,BBBB',
        },
      ]);
    });
  });

  describe('buildUserMessageFromTurnInput', () => {
    it('maps gateway file parts to assistant-ui attachments', () => {
      const message = buildUserMessageFromTurnInput(
        'turn-1',
        [
          {
            type: 'user.message',
            content: [
              { type: 'text', text: 'see attached' },
              {
                type: 'file',
                name: 'doc.pdf',
                data: 'data:application/pdf;base64,JVBERi0xLjQK',
              },
            ],
          },
        ],
        createdAt,
      );

      expect(message.role).toBe('user');
      expect(message.content).toEqual([{ type: 'text', text: 'see attached' }]);
      if (message.role !== 'user') {
        return;
      }
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0]?.name).toBe('doc.pdf');
    });

    it('maps gateway image_url parts to assistant-ui image attachments', () => {
      const message = buildUserMessageFromTurnInput(
        'turn-1',
        [
          {
            type: 'user.message',
            content: [
              { type: 'text', text: 'see attached' },
              {
                type: 'image_url',
                image_url: {
                  url: 'data:image/jpeg;base64,/9j/4AAQ',
                },
              },
            ] as never,
          },
        ],
        createdAt,
      );

      if (message.role !== 'user') {
        throw new Error('expected user message');
      }
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0]?.type).toBe('image');
      expect(message.attachments[0]?.content[0]).toMatchObject({
        type: 'image',
        image: 'data:image/jpeg;base64,/9j/4AAQ',
      });
    });
  });

  describe('turnStreamUpdateToAssistantMessage', () => {
    it('creates a new assistant message when none exists', () => {
      const message = turnStreamUpdateToAssistantMessage('turn-1', {
        content: [{ type: 'text', text: 'hi' }],
      });
      expect(message.id).toBe('turn-1-assistant');
      expect(message.role).toBe('assistant');
      expect(message.status).toEqual({ type: 'running' });
    });

    it('preserves the existing assistant message id on update', () => {
      const existing = turnStreamUpdateToAssistantMessage('turn-1', {
        content: [{ type: 'text', text: 'first' }],
      });
      const updated = turnStreamUpdateToAssistantMessage(
        'turn-1',
        { content: [{ type: 'text', text: 'second' }] },
        existing,
      );
      expect(updated.id).toBe(existing.id);
      expect(updated.content).toEqual([{ type: 'text', text: 'second' }]);
    });

    it('stamps the streaming turn id onto the message metadata', () => {
      const message = turnStreamUpdateToAssistantMessage('turn-1', {
        content: [{ type: 'text', text: 'hi' }],
      });
      expect(message.metadata.custom['turnId']).toBe('turn-1');
    });

    it('advances the turn id when a continuation reuses the existing message', () => {
      const existing = turnStreamUpdateToAssistantMessage('turn-1', {
        content: [{ type: 'text', text: 'first' }],
        metadata: { custom: { sandboxId: 'sbx-123' } },
      });
      const updated = turnStreamUpdateToAssistantMessage(
        'turn-2',
        { content: [{ type: 'text', text: 'second' }] },
        existing,
      );
      expect(updated.id).toBe('turn-1-assistant');
      expect(updated.metadata.custom['turnId']).toBe('turn-2');
      expect(updated.metadata.custom['sandboxId']).toBe('sbx-123');
    });
  });

  describe('repositoryItemsFromMessages', () => {
    it('chains parent ids in order', () => {
      const userMessage = {
        id: 'u1',
        role: 'user' as const,
        content: [{ type: 'text' as const, text: 'hi' }],
        attachments: [],
        createdAt: new Date(),
        metadata: { custom: {} },
      };
      const assistant = turnStreamUpdateToAssistantMessage('t1', {
        content: [{ type: 'text', text: 'a' }],
      });

      const items = repositoryItemsFromMessages([userMessage, assistant]);
      expect(items).toEqual([
        { parentId: null, message: userMessage },
        { parentId: 'u1', message: assistant },
      ]);
    });
  });

  describe('buildTurnAssistantContent', () => {
    it('aggregates turn listEvents into root assistant content', async () => {
      const turn = mockTurn({
        id: 'turn-1',
        createdAt,
      });
      const content = await buildTurnAssistantContent(mockServerWithTurns([turn]), SESSION_ID, turn);
      expect(content).toEqual([{ type: 'text', text: 'assistant reply' }]);
    });
  });

  describe('convertTurnsToThreadMessages', () => {
    it('builds user and assistant messages from completed turns', async () => {
      const result = await convertTurnsToThreadMessages(
        mockServerWithTurns([
          mockTurn({
            id: 'turn-1',
            createdAt,
            input: [{ type: 'user.message', content: 'hello' }],
          }),
        ]),
        SESSION_ID,
      );

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toMatchObject({
        id: 'turn-1-user',
        role: 'user',
        content: [{ type: 'text', text: 'hello' }],
      });
      expect(result.messages[1]).toMatchObject({
        id: 'turn-1-assistant',
        role: 'assistant',
        content: [{ type: 'text', text: 'assistant reply' }],
        status: { type: 'complete', reason: 'stop' },
      });
      expect(result.activeTurn).toBeUndefined();
    });

    it('carries sandboxId from a historical sandbox.created event onto the assistant message', async () => {
      const result = await convertTurnsToThreadMessages(
        mockServerWithTurns([
          mockTurn({
            id: 'turn-1',
            createdAt,
            input: [{ type: 'user.message', content: 'hello' }],
            events: [
              sandboxCreated({ id: 'sandbox-evt', sandboxId: 'sbx-123' }),
              modelMessage({
                id: 'm1',
                threadId: ROOT_THREAD_ID,
                content: 'assistant reply',
              }),
            ],
          }),
        ]),
        SESSION_ID,
      );

      expect(result.messages[1]).toMatchObject({
        role: 'assistant',
        metadata: { custom: { sandboxId: 'sbx-123', turnId: 'turn-1' } },
      });
    });

    it('stamps turnId without sandboxId when history omits sandbox.created (reused sandbox outside window)', async () => {
      const result = await convertTurnsToThreadMessages(
        mockServerWithTurns([
          mockTurn({
            id: 'turn-tip',
            createdAt,
            input: [{ type: 'user.message', content: 'download please' }],
            events: [
              modelMessage({
                id: 'm-tip',
                threadId: ROOT_THREAD_ID,
                content: 'here is the file',
              }),
            ],
          }),
        ]),
        SESSION_ID,
      );

      expect(result.messages[1]).toMatchObject({
        role: 'assistant',
        metadata: { custom: { turnId: 'turn-tip' } },
      });
      expect((result.messages[1]?.metadata.custom as { sandboxId?: string }).sandboxId).toBeUndefined();
    });

    it('propagates sandboxId onto later turns that reuse the sandbox without emitting sandbox.created', async () => {
      const createTurn = mockTurn({
        id: 'turn-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        previousTurnId: null,
        input: [{ type: 'user.message', content: 'create file' }],
        events: [
          sandboxCreated({ id: 'sandbox-evt', sandboxId: 'sbx-123' }),
          modelMessage({
            id: 'm1',
            threadId: ROOT_THREAD_ID,
            content: 'created',
          }),
        ],
      });
      const reuseTurn = mockTurn({
        id: 'turn-2',
        createdAt: '2026-01-01T00:01:00.000Z',
        previousTurnId: 'turn-1',
        input: [{ type: 'user.message', content: 'download it' }],
        events: [
          modelMessage({
            id: 'm2',
            threadId: ROOT_THREAD_ID,
            content: 'ready',
          }),
        ],
      });

      // Newest-first listTurns order (tip first).
      const result = await convertTurnsToThreadMessages(mockServerWithTurns([reuseTurn, createTurn]), SESSION_ID);

      const tipAssistant = result.messages.find(
        message => message.role === 'assistant' && (message.metadata.custom as { turnId?: string }).turnId === 'turn-2',
      );
      expect(tipAssistant).toMatchObject({
        metadata: { custom: { sandboxId: 'sbx-123', turnId: 'turn-2' } },
      });
    });

    it('returns activeTurn and unstable_resume for an in-flight turn', async () => {
      const runningTurn = mockTurn({
        id: 'turn-running',
        createdAt,
        state: { status: 'running' },
      });
      const result = await convertTurnsToThreadMessages(mockServerWithTurns([runningTurn]), SESSION_ID);

      expect(result.activeTurn).toBe(runningTurn);
      expect(result.unstable_resume).toBe(true);
      expect(result.messages.at(-1)?.role).toBe('assistant');
    });

    it('merges continuation turns without user input into the last assistant message', async () => {
      const firstTurn = mockTurn({
        id: 'turn-1',
        createdAt,
        events: [
          modelMessage({
            id: 'm1',
            threadId: ROOT_THREAD_ID,
            content: 'first chunk',
          }),
        ],
      });
      const continuationTurn = mockTurn({
        id: 'turn-2',
        createdAt,
        input: [
          { type: 'user.tool_approval', threadId: ROOT_THREAD_ID, toolCallId: 'tc-1', approval: { status: 'allow' } },
        ],
        events: [
          modelMessage({
            id: 'm2',
            threadId: ROOT_THREAD_ID,
            content: ' after approval',
          }),
        ],
      });

      const result = await convertTurnsToThreadMessages(mockServerWithTurns([continuationTurn, firstTurn]), SESSION_ID);

      expect(result.messages).toHaveLength(2);
      const assistant = result.messages[1];
      expect(assistant?.role).toBe('assistant');
      if (assistant?.role !== 'assistant') {
        return;
      }
      expect(assistant.content).toEqual([
        { type: 'text', text: 'first chunk' },
        { type: 'text', text: ' after approval' },
      ]);
      // Artifacts on a merged message belong to the turn that wrote them last.
      expect(assistant.metadata.custom['turnId']).toBe('turn-2');
    });

    it('keeps the sandboxId when an ask-user continuation is merged', async () => {
      const firstTurn = mockTurn({
        id: 'turn-1',
        createdAt,
        input: [{ type: 'user.message', content: 'create a file' }],
        events: [
          sandboxCreated({ id: 'sandbox-evt', sandboxId: 'sbx-123' }),
          modelMessage({
            id: 'm1',
            threadId: ROOT_THREAD_ID,
            content: 'Which format?',
          }),
        ],
      });
      const continuationTurn = mockTurn({
        id: 'turn-2',
        createdAt,
        input: [
          {
            type: 'user.tool_response',
            threadId: ROOT_THREAD_ID,
            toolCallId: 'ask-1',
            content: 'Markdown',
          },
        ],
        events: [
          modelMessage({
            id: 'm2',
            threadId: ROOT_THREAD_ID,
            content: 'Done',
          }),
        ],
      });

      const result = await convertTurnsToThreadMessages(mockServerWithTurns([continuationTurn, firstTurn]), SESSION_ID);

      expect(result.messages[1]).toMatchObject({
        role: 'assistant',
        metadata: {
          custom: {
            sandboxId: 'sbx-123',
            turnId: 'turn-2',
          },
        },
      });
    });

    it('clears pendingMcpAuth when an MCP auth continuation is merged', async () => {
      const mcpServers = [
        {
          id: 'github-auth',
          name: 'github',
          authUrl: 'https://example.com/auth',
        },
      ];
      const pausedTurn = mockTurn({
        id: 'turn-1',
        createdAt,
        input: [{ type: 'user.message', content: 'use github' }],
        state: {
          status: 'done',
          output: undefined,
          requiredActions: [
            {
              type: 'mcp.auth_required',
              id: 'mcp-auth',
              createdAt,
              mcpServers,
            },
          ] as never,
          completedAt: createdAt,
        },
        events: [
          sandboxCreated({ id: 'sandbox-evt', sandboxId: 'sbx-123' }),
          modelMessage({
            id: 'm1',
            threadId: ROOT_THREAD_ID,
            content: 'Need auth',
          }),
          {
            type: 'mcp.auth_required',
            id: 'mcp-auth',
            createdAt,
            mcpServers,
          },
        ],
      });
      const continuationTurn = mockTurn({
        id: 'turn-2',
        createdAt,
        input: [],
        events: [
          modelMessage({
            id: 'm2',
            threadId: ROOT_THREAD_ID,
            content: 'Authorized',
          }),
        ],
      });

      const result = await convertTurnsToThreadMessages(
        mockServerWithTurns([continuationTurn, pausedTurn]),
        SESSION_ID,
      );

      const assistant = result.messages[1];
      expect(assistant?.role).toBe('assistant');
      if (assistant?.role !== 'assistant') {
        return;
      }
      expect(assistant.status).toEqual({ type: 'complete', reason: 'stop' });
      expect(assistant.metadata.custom).toEqual({
        sandboxId: 'sbx-123',
        turnId: 'turn-2',
      });
      expect(assistant.metadata.custom['pendingMcpAuth']).toBeUndefined();
    });

    it('preserves requires-action on reload when a turn ends awaiting tool approval', async () => {
      const pausedTurn = mockTurn({
        id: 'turn-approval',
        createdAt,
        input: [{ type: 'user.message', content: 'run tool' }],
        state: {
          status: 'done',
          output: undefined,
          requiredActions: [
            approvalRequired({
              id: 'approval-event',
              threadId: ROOT_THREAD_ID,
              toolCalls: [{ id: 'approval-1', sourceEventId: 'm1' }],
            }),
          ] as never,
          completedAt: createdAt,
        },
        events: [
          modelMessage({
            id: 'm1',
            threadId: ROOT_THREAD_ID,
            content: 'run tool',
            toolCalls: [
              {
                id: 'approval-1',
                type: 'function',
                function: { name: 'bash', arguments: '{}' },
                toolInfo: {
                  type: 'mcp',
                  name: 'bash',
                  serverId: 'bash-server',
                  serverName: 'bash',
                },
              },
            ],
          }),
          approvalRequired({
            id: 'approval-event',
            threadId: ROOT_THREAD_ID,
            toolCalls: [{ id: 'approval-1', sourceEventId: 'm1' }],
          }),
        ],
      });

      const result = await convertTurnsToThreadMessages(mockServerWithTurns([pausedTurn]), SESSION_ID);

      expect(result.messages).toHaveLength(2);
      const assistant = result.messages[1];
      expect(assistant?.role).toBe('assistant');
      if (assistant?.role !== 'assistant') {
        return;
      }
      expect(assistant.status).toEqual({
        type: 'requires-action',
        reason: 'tool-calls',
      });
      expect(assistant.metadata.custom[MESSAGE_CUSTOM_KEY.TOOL_APPROVAL_THREAD_ID]).toBe(ROOT_THREAD_ID);
      expect(assistant.content.find(part => part.type === 'tool-call')).toMatchObject({
        type: 'tool-call',
        toolCallId: 'approval-1',
        approval: { id: 'approval-1' },
      });
      expect(findPausedAssistantMessage(result.messages)).toBe(assistant);
    });

    it('downgrades to complete after a later turn submits user.tool_approval', async () => {
      const pausedTurn = mockTurn({
        id: 'turn-approval',
        createdAt,
        input: [{ type: 'user.message', content: 'run tool' }],
        state: {
          status: 'done',
          output: undefined,
          requiredActions: [
            approvalRequired({
              id: 'approval-event',
              threadId: ROOT_THREAD_ID,
              toolCalls: [{ id: 'approval-1', sourceEventId: 'm1' }],
            }),
          ] as never,
          completedAt: createdAt,
        },
        events: [
          modelMessage({
            id: 'm1',
            threadId: ROOT_THREAD_ID,
            content: 'run tool',
            toolCalls: [
              {
                id: 'approval-1',
                type: 'function',
                function: { name: 'bash', arguments: '{}' },
                toolInfo: {
                  type: 'mcp',
                  name: 'bash',
                  serverId: 'bash-server',
                  serverName: 'bash',
                },
              },
            ],
          }),
          approvalRequired({
            id: 'approval-event',
            threadId: ROOT_THREAD_ID,
            toolCalls: [{ id: 'approval-1', sourceEventId: 'm1' }],
          }),
        ],
      });
      const continuationTurn = mockTurn({
        id: 'turn-approval-resume',
        createdAt,
        input: [
          {
            type: 'user.tool_approval',
            threadId: ROOT_THREAD_ID,
            toolCallId: 'approval-1',
            approval: { status: 'allow' },
          },
        ],
        events: [
          modelMessage({
            id: 'm2',
            threadId: ROOT_THREAD_ID,
            content: 'done',
          }),
        ],
      });

      const result = await convertTurnsToThreadMessages(
        mockServerWithTurns([continuationTurn, pausedTurn]),
        SESSION_ID,
      );

      const assistant = result.messages[1];
      expect(assistant?.role).toBe('assistant');
      if (assistant?.role !== 'assistant') {
        return;
      }
      expect(assistant.status).toEqual({ type: 'complete', reason: 'stop' });
      expect(assistant.metadata.custom[MESSAGE_CUSTOM_KEY.TOOL_APPROVAL_THREAD_ID]).toBeUndefined();
      const toolCall = assistant.content.find(part => part.type === 'tool-call');
      expect(toolCall?.type).toBe('tool-call');
      if (toolCall?.type !== 'tool-call') {
        return;
      }
      expect(toolCall.approval?.approved).toBe(true);
    });

    it('preserves requires-action on reload when a turn ends awaiting tool response', async () => {
      const pausedTurn = mockTurn({
        id: 'turn-response',
        createdAt,
        input: [{ type: 'user.message', content: 'ask me' }],
        state: {
          status: 'done',
          output: undefined,
          requiredActions: [
            responseRequired({
              id: 'resp-req-1',
              threadId: ROOT_THREAD_ID,
              toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
            }),
          ] as never,
          completedAt: createdAt,
        },
        events: [
          modelMessage({
            id: 'model-1',
            threadId: ROOT_THREAD_ID,
            toolCalls: [
              {
                id: 'question-1',
                type: 'function',
                function: {
                  name: 'ask_user_question',
                  arguments: JSON.stringify({
                    question: 'Pick one',
                    options: ['A', 'B'],
                  }),
                },
                toolInfo: {
                  type: 'trueforge-system',
                  name: 'ask_user_question',
                },
              },
            ],
          }),
          responseRequired({
            id: 'resp-req-1',
            threadId: ROOT_THREAD_ID,
            toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
          }),
        ],
      });

      const result = await convertTurnsToThreadMessages(mockServerWithTurns([pausedTurn]), SESSION_ID);

      const assistant = result.messages[1];
      expect(assistant?.role).toBe('assistant');
      if (assistant?.role !== 'assistant') {
        return;
      }
      expect(assistant.status).toEqual({
        type: 'requires-action',
        reason: 'tool-calls',
      });
      expect(assistant.metadata.custom[MESSAGE_CUSTOM_KEY.TOOL_RESPONSE_THREAD_ID]).toBe(ROOT_THREAD_ID);
      expect(assistant.content[0]).toMatchObject({
        type: 'tool-call',
        toolCallId: 'question-1',
        interrupt: {
          type: 'human',
          payload: { question: 'Pick one', options: ['A', 'B'] },
        },
      });
      expect(findPausedAssistantMessage(result.messages)).toBe(assistant);
    });

    it('downgrades to complete after a later turn submits user.tool_response', async () => {
      const pausedTurn = mockTurn({
        id: 'turn-response',
        createdAt,
        input: [{ type: 'user.message', content: 'ask me' }],
        state: {
          status: 'done',
          output: undefined,
          requiredActions: [
            responseRequired({
              id: 'resp-req-1',
              threadId: ROOT_THREAD_ID,
              toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
            }),
          ] as never,
          completedAt: createdAt,
        },
        events: [
          modelMessage({
            id: 'model-1',
            threadId: ROOT_THREAD_ID,
            toolCalls: [
              {
                id: 'question-1',
                type: 'function',
                function: {
                  name: 'ask_user_question',
                  arguments: JSON.stringify({
                    question: 'Pick one',
                    options: ['A', 'B'],
                  }),
                },
                toolInfo: {
                  type: 'trueforge-system',
                  name: 'ask_user_question',
                },
              },
            ],
          }),
          responseRequired({
            id: 'resp-req-1',
            threadId: ROOT_THREAD_ID,
            toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
          }),
        ],
      });
      const continuationTurn = mockTurn({
        id: 'turn-response-resume',
        createdAt,
        input: [
          {
            type: 'user.tool_response',
            threadId: ROOT_THREAD_ID,
            toolCallId: 'question-1',
            content: 'A',
          },
        ],
        events: [
          modelMessage({
            id: 'model-2',
            threadId: ROOT_THREAD_ID,
            content: 'Thanks',
          }),
        ],
      });

      const result = await convertTurnsToThreadMessages(
        mockServerWithTurns([continuationTurn, pausedTurn]),
        SESSION_ID,
      );

      const assistant = result.messages[1];
      expect(assistant?.role).toBe('assistant');
      if (assistant?.role !== 'assistant') {
        return;
      }
      expect(assistant.status).toEqual({ type: 'complete', reason: 'stop' });
      expect(assistant.metadata.custom[MESSAGE_CUSTOM_KEY.TOOL_RESPONSE_THREAD_ID]).toBeUndefined();
      const toolCall = assistant.content[0];
      expect(toolCall?.type).toBe('tool-call');
      if (toolCall?.type !== 'tool-call') {
        return;
      }
      expect(toolCall.result).toBe('A');
    });

    it('scopes assistant content to each user turn group', async () => {
      const helloTurn = mockTurn({
        id: 'turn-hello',
        createdAt,
        input: [{ type: 'user.message', content: 'hello' }],
        events: [
          modelMessage({
            id: 'm-hello',
            threadId: ROOT_THREAD_ID,
            content: 'Hello! How can I help?',
          }),
        ],
      });
      const analyzeTurn = mockTurn({
        id: 'turn-analyze',
        createdAt,
        input: [{ type: 'user.message', content: 'analyze' }],
        events: [
          modelMessage({
            id: 'm-analyze',
            threadId: ROOT_THREAD_ID,
            content: 'Let me look at the file.',
          }),
        ],
      });
      const ticketsTurn = mockTurn({
        id: 'turn-tickets',
        createdAt,
        input: [
          {
            type: 'user.message',
            content: 'create linear tickets',
          },
        ],
        events: [
          modelMessage({
            id: 'm-tickets',
            threadId: ROOT_THREAD_ID,
            content: 'Creating tickets now.',
          }),
        ],
      });

      const result = await convertTurnsToThreadMessages(
        mockServerWithTurns([ticketsTurn, analyzeTurn, helloTurn]),
        SESSION_ID,
      );

      expect(result.messages).toHaveLength(6);
      expect(result.messages[1]).toMatchObject({
        id: 'turn-hello-assistant',
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello! How can I help?' }],
      });
      expect(result.messages[3]).toMatchObject({
        id: 'turn-analyze-assistant',
        role: 'assistant',
        content: [{ type: 'text', text: 'Let me look at the file.' }],
      });
      expect(result.messages[5]).toMatchObject({
        id: 'turn-tickets-assistant',
        role: 'assistant',
        content: [{ type: 'text', text: 'Creating tickets now.' }],
      });
    });

    it('projects file attachments on user messages from turn input', async () => {
      const fileData = 'data:text/x-python;base64,cHJpbnQoJ2hlbGxvJyk=';
      const analyzeTurn = mockTurn({
        id: 'turn-analyze',
        createdAt,
        input: [
          {
            type: 'user.message',
            content: [
              { type: 'text', text: 'analyze' },
              { type: 'file', name: 'Untitled.py', data: fileData },
            ],
          },
        ],
        events: [
          modelMessage({
            id: 'm-analyze',
            threadId: ROOT_THREAD_ID,
            content: 'File analyzed.',
          }),
        ],
      });

      const result = await convertTurnsToThreadMessages(mockServerWithTurns([analyzeTurn]), SESSION_ID);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toMatchObject({
        id: 'turn-analyze-user',
        role: 'user',
        content: [{ type: 'text', text: 'analyze' }],
      });
      if (result.messages[0]?.role !== 'user') {
        return;
      }
      expect(result.messages[0].attachments).toHaveLength(1);
      expect(result.messages[0].attachments[0]).toMatchObject({
        type: 'file',
        name: 'Untitled.py',
        contentType: 'text/x-python',
        status: { type: 'complete' },
        content: [
          {
            type: 'file',
            mimeType: 'text/x-python',
            filename: 'Untitled.py',
            data: fileData,
          },
        ],
      });
    });

    it('projects file-only turns and their assistant response', async () => {
      const fileData = 'data:image/png;base64,AAAA';
      const turn = mockTurn({
        id: 'turn-image',
        createdAt,
        input: [
          {
            type: 'user.message',
            content: [{ type: 'file', name: 'image.png', data: fileData }],
          },
        ],
        events: [
          modelMessage({
            id: 'm-image',
            threadId: ROOT_THREAD_ID,
            content: 'Image received.',
          }),
        ],
      });

      const result = await convertTurnsToThreadMessages(mockServerWithTurns([turn]), SESSION_ID);

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toMatchObject({
        id: 'turn-image-user',
        role: 'user',
        content: [{ type: 'text', text: '' }],
        attachments: [{ name: 'image.png', status: { type: 'complete' } }],
      });
      expect(result.messages[1]).toMatchObject({
        id: 'turn-image-assistant',
        role: 'assistant',
        content: [{ type: 'text', text: 'Image received.' }],
      });
      expect(turnToSessionRecord(turn)).toHaveProperty('userText', '');
    });

    it('nests sub-agents within a turn group and isolates the next user turn', async () => {
      const spawnTurn = mockTurn({
        id: 'turn-spawn',
        createdAt,
        input: [{ type: 'user.message', content: 'spawn agent' }],
        events: [
          modelMessage({
            id: 'root-spawn',
            threadId: ROOT_THREAD_ID,
            toolCalls: [
              {
                id: 'spawn-1',
                type: 'function',
                function: { name: 'create_sub_agent', arguments: '{}' },
                toolInfo: {
                  type: 'trueforge-system',
                  name: 'create_sub_agent',
                },
              },
            ],
          }),
          threadCreated({
            id: 't-created',
            threadId: 'child-1',
            title: 'Research agent',
            agentInfo: {
              type: 'dynamic',
              name: 'researcher',
              input: 'do research',
            },
            parent: { threadId: ROOT_THREAD_ID, toolCallId: 'spawn-1' },
          }),
          modelMessage({
            id: 'child-msg-1',
            threadId: 'child-1',
            content: 'initial child work',
          }),
        ],
      });
      const continuationTurn = mockTurn({
        id: 'turn-continuation',
        createdAt,
        input: [
          {
            type: 'user.tool_approval',
            threadId: ROOT_THREAD_ID,
            toolCallId: 'spawn-1',
            approval: { status: 'allow' },
          },
        ],
        events: [
          modelMessage({
            id: 'child-msg-2',
            threadId: 'child-1',
            content: 'more child work',
          }),
        ],
      });
      const nextUserTurn = mockTurn({
        id: 'turn-next',
        createdAt,
        input: [{ type: 'user.message', content: 'thanks' }],
        events: [
          modelMessage({
            id: 'm-thanks',
            threadId: ROOT_THREAD_ID,
            content: "You're welcome!",
          }),
        ],
      });

      const result = await convertTurnsToThreadMessages(
        mockServerWithTurns([nextUserTurn, continuationTurn, spawnTurn]),
        SESSION_ID,
      );

      expect(result.messages).toHaveLength(4);
      const groupAssistant = result.messages[1];
      expect(groupAssistant?.role).toBe('assistant');
      if (groupAssistant?.role !== 'assistant') {
        return;
      }
      const spawnPart = groupAssistant.content.find(part => part.type === 'tool-call');
      expect(spawnPart?.type).toBe('tool-call');
      if (spawnPart?.type !== 'tool-call') {
        return;
      }
      expect(spawnPart.artifact).toEqual({
        subAgents: [
          {
            threadId: 'child-1',
            title: 'Research agent',
            agentInfo: {
              type: 'dynamic',
              name: 'researcher',
              input: 'do research',
            },
          },
        ],
      });
      expect(spawnPart.messages?.[0]?.metadata.custom['subAgent']).toEqual({
        threadId: 'child-1',
        title: 'Research agent',
        name: 'researcher',
        input: 'do research',
      });

      const nextAssistant = result.messages[3];
      expect(nextAssistant?.role).toBe('assistant');
      if (nextAssistant?.role !== 'assistant') {
        return;
      }
      expect(nextAssistant.content).toEqual([{ type: 'text', text: "You're welcome!" }]);
      expect(nextAssistant.content.some(part => part.type === 'tool-call')).toBe(false);
    });
  });

  describe('streamTurnEvents', () => {
    it('yields folded root content as model messages arrive', async () => {
      const foldState = new PeerThreadFoldState();
      const updates = await collectStream(
        streamTurnEvents(
          streamFrom([
            modelMessage({
              id: 'm1',
              threadId: ROOT_THREAD_ID,
              content: 'streaming',
            }),
          ]),
          foldState,
        ),
      );

      expect(updates).toEqual([{ content: [{ type: 'text', text: 'streaming' }], sequenceNumber: 1 }]);
    });

    it('yields folded content after each ingested stream event', async () => {
      const foldState = new PeerThreadFoldState();
      const updates = await collectStream(
        streamTurnEvents(
          streamFrom([
            modelMessage({
              id: 'm1',
              threadId: ROOT_THREAD_ID,
              content: 'first',
            }),
            modelMessage({
              id: 'm2',
              threadId: ROOT_THREAD_ID,
              content: 'second',
            }),
            modelMessage({
              id: 'm3',
              threadId: ROOT_THREAD_ID,
              content: 'third',
            }),
          ]),
          foldState,
        ),
      );

      expect(updates).toHaveLength(3);
      expect(updates[0]?.content).toEqual([{ type: 'text', text: 'first' }]);
      expect(updates[1]?.content).toEqual([
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
      ]);
      expect(updates[2]?.content).toEqual([
        { type: 'text', text: 'first' },
        { type: 'text', text: 'second' },
        { type: 'text', text: 'third' },
      ]);
    });

    it('scopes streamed content to ids after the group baseline', async () => {
      const foldState = new PeerThreadFoldState();
      foldState.getOrCreateBucket(ROOT_THREAD_ID);
      foldState.threads.get(ROOT_THREAD_ID)!.modelMessageIds.push('prior');
      foldState.threads.get(ROOT_THREAD_ID)!.events.set(
        'prior',
        modelMessage({
          id: 'prior',
          threadId: ROOT_THREAD_ID,
          content: 'old turn',
        }),
      );

      const updates = await collectStream(
        streamTurnEvents(
          streamFrom([
            modelMessage({
              id: 'm-new',
              threadId: ROOT_THREAD_ID,
              content: 'new turn only',
            }),
          ]),
          foldState,
          ['prior'],
        ),
      );

      expect(updates).toEqual([{ content: [{ type: 'text', text: 'new turn only' }], sequenceNumber: 1 }]);
    });

    it('projects terminal turn errors', async () => {
      const foldState = new PeerThreadFoldState();
      const updates = await collectStream(
        streamTurnEvents(
          streamFrom([
            {
              type: 'turn.done',
              id: 'turn-done',
              createdAt,
              state: {
                status: 'error',
                message: 'boom',
                completedAt: createdAt,
              },
            },
          ]),
          foldState,
        ),
      );
      expect(updates.at(-1)).toMatchObject({
        status: { type: 'incomplete', reason: 'error', error: 'boom' },
        turnState: { status: 'error', message: 'boom' },
      });
    });

    it('emits tool approval metadata after the stream when approvals remain pending', async () => {
      const foldState = new PeerThreadFoldState();
      const updates = await collectStream(
        streamTurnEvents(
          streamFrom([
            modelMessage({
              id: 'm1',
              threadId: ROOT_THREAD_ID,
              content: 'run tool',
              toolCalls: [
                {
                  id: 'approval-1',
                  type: 'function',
                  function: { name: 'bash', arguments: '{}' },
                  toolInfo: {
                    type: 'mcp',
                    name: 'bash',
                    serverId: 'bash-server',
                    serverName: 'bash',
                  },
                },
              ],
            }),
            approvalRequired({
              id: 'approval-event',
              threadId: ROOT_THREAD_ID,
              toolCalls: [{ id: 'approval-1', sourceEventId: 'm1' }],
            }),
            {
              type: 'turn.update',
              id: 'pause-1',
              createdAt,
              threadId: null,
              state: {
                status: 'paused',
                actionRequiredOnEvents: [{ id: 'approval-event' }],
                pausedAt: createdAt,
              },
            },
          ]),
          foldState,
        ),
      );

      const final = updates.at(-1);
      expect(final?.status).toEqual({
        type: 'requires-action',
        reason: 'tool-calls',
      });
      expect(final?.metadata?.custom?.[MESSAGE_CUSTOM_KEY.TOOL_APPROVAL_THREAD_ID]).toBe(ROOT_THREAD_ID);
    });

    it('defers mcp auth until stream end and appends auth prompt', async () => {
      const foldState = new PeerThreadFoldState();
      const updates = await collectStream(
        streamTurnEvents(
          streamFrom([
            modelMessage({
              id: 'm1',
              threadId: ROOT_THREAD_ID,
              content: 'before auth',
            }),
            {
              type: 'mcp.auth_required',
              id: 'mcp-auth',
              createdAt,
              mcpServers: [
                {
                  id: 'github-auth',
                  name: 'github',
                  authUrl: 'https://example.com/auth',
                },
              ],
            },
            {
              type: 'turn.update',
              id: 'pause-mcp',
              createdAt,
              threadId: null,
              state: {
                status: 'paused',
                actionRequiredOnEvents: [{ id: 'mcp-auth' }],
                pausedAt: createdAt,
              },
            },
          ]),
          foldState,
        ),
      );

      expect(updates).toHaveLength(2);
      expect(updates[0]).toEqual({ content: [{ type: 'text', text: 'before auth' }], sequenceNumber: 1 });
      expect(updates[1]?.status).toEqual({
        type: 'requires-action',
        reason: 'interrupt',
      });
      expect(updates[1]?.content.at(-1)).toMatchObject({
        type: 'text',
        text: expect.stringContaining('Connect'),
      });
    });

    it('stamps sandboxId onto every content yield after sandbox.created is seen', async () => {
      const foldState = new PeerThreadFoldState();
      const updates = await collectStream(
        streamTurnEvents(
          streamFrom([
            modelMessage({
              id: 'm1',
              threadId: ROOT_THREAD_ID,
              content: 'before sandbox',
            }),
            sandboxCreated({ id: 'sandbox-evt', sandboxId: 'sbx-123' }),
            modelMessage({
              id: 'm2',
              threadId: ROOT_THREAD_ID,
              content: 'after sandbox',
            }),
          ]),
          foldState,
        ),
      );

      expect(updates).toHaveLength(2);
      expect(updates[0]?.metadata?.custom?.['sandboxId']).toBeUndefined();
      expect(updates[1]?.metadata?.custom?.['sandboxId']).toBe('sbx-123');
    });

    it('yields a trailing update carrying sandboxId when sandbox.created is the last event', async () => {
      const foldState = new PeerThreadFoldState();
      const updates = await collectStream(
        streamTurnEvents(
          streamFrom([
            modelMessage({
              id: 'm1',
              threadId: ROOT_THREAD_ID,
              content: 'some content',
            }),
            sandboxCreated({ id: 'sandbox-evt', sandboxId: 'sbx-123' }),
          ]),
          foldState,
        ),
      );

      const final = updates.at(-1);
      expect(final?.metadata?.custom?.['sandboxId']).toBe('sbx-123');
    });

    it('keeps sandboxId on the final mcp auth yield when both occur in the same stream', async () => {
      const foldState = new PeerThreadFoldState();
      const updates = await collectStream(
        streamTurnEvents(
          streamFrom([
            sandboxCreated({ id: 'sandbox-evt', sandboxId: 'sbx-123' }),
            modelMessage({
              id: 'm1',
              threadId: ROOT_THREAD_ID,
              content: 'before auth',
            }),
            {
              type: 'mcp.auth_required',
              id: 'mcp-auth',
              createdAt,
              mcpServers: [
                {
                  id: 'github-auth',
                  name: 'github',
                  authUrl: 'https://example.com/auth',
                },
              ],
            },
            {
              type: 'turn.update',
              id: 'pause-mcp',
              createdAt,
              threadId: null,
              state: {
                status: 'paused',
                actionRequiredOnEvents: [{ id: 'mcp-auth' }],
                pausedAt: createdAt,
              },
            },
          ]),
          foldState,
        ),
      );

      const final = updates.at(-1);
      expect(final?.metadata?.custom?.['sandboxId']).toBe('sbx-123');
      expect(final?.status).toEqual({ type: 'requires-action', reason: 'interrupt' });
    });
  });

  describe('projectSessionMessages paused segment', () => {
    const turnId = 'turn-live';

    function snapshotWithCompletedStream(update: TurnStreamUpdate, foldState: PeerThreadFoldState) {
      return {
        ...replaceSessionSnapshot(createEmptySessionSnapshot(), {
          pendingUser: {
            turnId,
            content: 'hello',
            createdAt: new Date(createdAt),
          },
          activeStream: {
            turnId,
            update,
            segmentStatus: 'paused',
          },
        }),
        fold: foldState,
      };
    }

    it('keeps streamed images on the assistant message for text-only user prompts', () => {
      const imageDataUri = 'data:image/jpeg;base64,/9j/4AAQ';
      const messages = projectSessionMessages(
        replaceSessionSnapshot(createEmptySessionSnapshot(), {
          pendingUser: {
            turnId,
            content: 'Create image of dog',
            createdAt: new Date(createdAt),
          },
          activeStream: {
            turnId,
            update: {
              content: [
                {
                  type: 'image',
                  image: imageDataUri,
                  filename: 'image-1.jpeg',
                },
              ],
            },
            segmentStatus: 'paused',
          },
        }),
      );

      expect(messages).toHaveLength(2);
      const user = messages[0];
      const assistant = messages[1];
      expect(user?.role).toBe('user');
      if (user?.role !== 'user') {
        return;
      }
      expect(user.attachments).toEqual([]);
      expect(assistant?.role).toBe('assistant');
      if (assistant?.role !== 'assistant') {
        return;
      }
      expect(assistant.content).toEqual([
        {
          type: 'image',
          image: imageDataUri,
          filename: 'image-1.jpeg',
        },
      ]);
    });

    it('preserves requires-action when a paused segment has approval status', async () => {
      const foldState = new PeerThreadFoldState();
      const updates = await collectStream(
        streamTurnEvents(
          streamFrom([
            modelMessage({
              id: 'm1',
              threadId: ROOT_THREAD_ID,
              content: 'run tool',
              toolCalls: [
                {
                  id: 'approval-1',
                  type: 'function',
                  function: { name: 'bash', arguments: '{}' },
                  toolInfo: {
                    type: 'mcp',
                    name: 'bash',
                    serverId: 'bash-server',
                    serverName: 'bash',
                  },
                },
              ],
            }),
            approvalRequired({
              id: 'approval-event',
              threadId: ROOT_THREAD_ID,
              toolCalls: [{ id: 'approval-1', sourceEventId: 'm1' }],
            }),
            {
              type: 'turn.update',
              id: 'pause-approval',
              createdAt,
              threadId: null,
              state: {
                status: 'paused',
                actionRequiredOnEvents: [{ id: 'approval-event' }],
                pausedAt: createdAt,
              },
            },
          ]),
          foldState,
        ),
      );

      const finalUpdate = updates.at(-1)!;
      const messages = projectSessionMessages(snapshotWithCompletedStream(finalUpdate, foldState));

      const assistant = messages.at(-1);
      expect(assistant?.role).toBe('assistant');
      if (assistant?.role !== 'assistant') {
        return;
      }
      expect(assistant.status).toEqual({
        type: 'requires-action',
        reason: 'tool-calls',
      });
      expect(assistant.content.find(part => part.type === 'tool-call')).toMatchObject({
        type: 'tool-call',
        toolCallId: 'approval-1',
        approval: { id: 'approval-1' },
      });
      expect(findPausedAssistantMessage(messages)).toBe(assistant);
    });

    it('preserves requires-action when a paused segment has ask-user status', async () => {
      const foldState = new PeerThreadFoldState();
      const updates = await collectStream(
        streamTurnEvents(
          streamFrom([
            modelMessage({
              id: 'model-1',
              threadId: ROOT_THREAD_ID,
              toolCalls: [
                {
                  id: 'question-1',
                  type: 'function',
                  function: {
                    name: 'ask_user_question',
                    arguments: JSON.stringify({
                      question: 'Pick one',
                      options: ['A', 'B'],
                    }),
                  },
                  toolInfo: {
                    type: 'trueforge-system',
                    name: 'ask_user_question',
                  },
                },
              ],
            }),
            responseRequired({
              id: 'resp-req-1',
              threadId: ROOT_THREAD_ID,
              toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
            }),
            {
              type: 'turn.update',
              id: 'pause-response',
              createdAt,
              threadId: null,
              state: {
                status: 'paused',
                actionRequiredOnEvents: [{ id: 'resp-req-1' }],
                pausedAt: createdAt,
              },
            },
          ]),
          foldState,
        ),
      );

      const finalUpdate = updates.at(-1)!;
      const messages = projectSessionMessages(snapshotWithCompletedStream(finalUpdate, foldState));

      const assistant = messages.at(-1);
      expect(assistant?.role).toBe('assistant');
      if (assistant?.role !== 'assistant') {
        return;
      }
      expect(assistant.status).toEqual({
        type: 'requires-action',
        reason: 'tool-calls',
      });
      expect(assistant.content[0]).toMatchObject({
        type: 'tool-call',
        toolCallId: 'question-1',
        interrupt: {
          type: 'human',
          payload: { question: 'Pick one', options: ['A', 'B'] },
        },
      });
      expect(findPausedAssistantMessage(messages)).toBe(assistant);
    });

    it('keeps an unclassified non-terminal segment running', () => {
      const foldState = new PeerThreadFoldState();
      const messages = projectSessionMessages(
        snapshotWithCompletedStream({ content: [{ type: 'text', text: 'done' }] }, foldState),
      );

      const assistant = messages.at(-1);
      expect(assistant?.role).toBe('assistant');
      if (assistant?.role !== 'assistant') {
        return;
      }
      expect(assistant.status).toEqual({
        type: 'running',
      });
    });
  });

  describe('ask-user reload projection', () => {
    it('does not resurface answered ask-user prompts after a continuation turn', () => {
      const fold = new PeerThreadFoldState();
      const turn1Id = 'turn-1';
      const turn2Id = 'turn-2';
      const initialCompletedAt = '2026-09-15T09:00:12.000Z';
      const continuationCompletedAt = '2026-09-15T09:01:08.000Z';

      ingestTurnEvent(
        fold,
        modelMessage({
          id: 'model-1',
          threadId: ROOT_THREAD_ID,
          toolCalls: [
            {
              id: 'question-1',
              type: 'function',
              function: {
                name: 'ask_user_question',
                arguments: JSON.stringify({
                  question: 'What would you like help with today?',
                  options: ['Help with a coding or technical task'],
                }),
              },
              toolInfo: {
                type: 'trueforge-system',
                name: 'ask_user_question',
              },
            },
          ],
        }),
      );
      ingestTurnEvent(
        fold,
        responseRequired({
          id: 'resp-req-1',
          threadId: ROOT_THREAD_ID,
          toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
        }),
      );
      applyUserToolResponsesToFold(fold, []);

      ingestTurnEvent(
        fold,
        modelMessage({
          id: 'model-2',
          threadId: ROOT_THREAD_ID,
          content: "Great, you'd like help with a coding task!",
        }),
      );
      applyUserToolResponsesToFold(fold, [
        {
          type: 'user.tool_response',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'question-1',
          content: 'Help with a coding or technical task',
        },
      ]);

      const snapshot = replaceSessionSnapshot(createEmptySessionSnapshot(), {
        fold,
        turns: [
          {
            id: turn1Id,
            createdAt,
            userText: 'hello',
            state: {
              status: 'done',
              requiredActions: [],
              completedAt: initialCompletedAt,
            },
            input: [{ type: 'user.message', content: 'hello' }],
            rootModelMessageIds: ['model-1'],
          },
          {
            id: turn2Id,
            createdAt,
            state: {
              status: 'done',
              requiredActions: [],
              completedAt: continuationCompletedAt,
            },
            input: [
              {
                type: 'user.tool_response',
                threadId: ROOT_THREAD_ID,
                toolCallId: 'question-1',
                content: 'Help with a coding or technical task',
              },
            ],
            rootModelMessageIds: ['model-2'],
          },
        ],
      });

      const messages = projectSessionMessages(snapshot);
      expect(collectPendingToolResponses(messages)).toHaveLength(0);

      const assistant = messages.find(message => message.role === 'assistant');
      expect(assistant).toBeDefined();
      expect(assistant?.createdAt).toEqual(new Date(continuationCompletedAt));
      const toolCall = assistant?.content.find(part => part.type === 'tool-call');
      expect(toolCall).toMatchObject({
        type: 'tool-call',
        toolCallId: 'question-1',
        result: 'Help with a coding or technical task',
      });
      if (toolCall?.type === 'tool-call') {
        expect(toolCall.interrupt).toBeUndefined();
      }
    });

    it('keeps a committed ask-user pause as requires-action so it can be resumed', () => {
      // Reproduces the live-stream pause path: once the SSE stream ends,
      // `commitActiveStream` moves the paused turn into `turns` with a
      // fabricated `TurnStateDone`. The pause must survive as a
      // `tool.response_required` required action, otherwise the projected
      // assistant message is not `requires-action` and
      // `findPausedAssistantMessage` (the gate that fires the resume turn)
      // never sees it.
      const fold = new PeerThreadFoldState();
      const turnId = 'turn-ask';

      ingestTurnEvent(
        fold,
        modelMessage({
          id: 'model-1',
          threadId: ROOT_THREAD_ID,
          toolCalls: [
            {
              id: 'question-1',
              type: 'function',
              function: {
                name: 'ask_user_question',
                arguments: JSON.stringify({
                  question: 'Pick one',
                  options: ['A', 'B'],
                }),
              },
              toolInfo: {
                type: 'trueforge-system',
                name: 'ask_user_question',
              },
            },
          ],
        }),
      );
      ingestTurnEvent(
        fold,
        responseRequired({
          id: 'resp-req-1',
          threadId: ROOT_THREAD_ID,
          toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
        }),
      );

      const snapshot = replaceSessionSnapshot(createEmptySessionSnapshot(), {
        fold,
        turns: [
          {
            id: turnId,
            createdAt,
            userText: 'ask me a question',
            state: {
              status: 'done',
              requiredActions: [
                responseRequired({
                  id: 'resp-req-1',
                  threadId: ROOT_THREAD_ID,
                  toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
                }),
              ] as never,
              completedAt: createdAt,
            },
            input: [{ type: 'user.message', content: 'ask me a question' }],
            rootModelMessageIds: ['model-1'],
          },
        ],
      });

      const messages = projectSessionMessages(snapshot);
      const paused = findPausedAssistantMessage(messages);
      expect(paused).toBeDefined();
      expect(paused?.status).toMatchObject({ type: 'requires-action' });
    });

    it('rebuilds paused activeStream content from fold after an ask-user answer is recorded', () => {
      const fold = new PeerThreadFoldState();
      const turnId = 'turn-ask';

      ingestTurnEvent(
        fold,
        modelMessage({
          id: 'model-1',
          threadId: ROOT_THREAD_ID,
          toolCalls: [
            {
              id: 'question-1',
              type: 'function',
              function: {
                name: 'ask_user_question',
                arguments: JSON.stringify({
                  question: 'Pick one',
                  options: ['A', 'B'],
                }),
              },
              toolInfo: {
                type: 'trueforge-system',
                name: 'ask_user_question',
              },
            },
          ],
        }),
      );
      ingestTurnEvent(
        fold,
        responseRequired({
          id: 'resp-req-1',
          threadId: ROOT_THREAD_ID,
          toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
        }),
      );

      const pausedContent = buildRootAssistantContent(fold);
      applyUserToolResponsesToFold(fold, [
        {
          type: 'user.tool_response',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'question-1',
          content: 'A',
        },
      ]);

      const snapshot = replaceSessionSnapshot(createEmptySessionSnapshot(), {
        fold,
        pendingUser: {
          turnId,
          content: 'ask me a question',
          createdAt: new Date(createdAt),
        },
        activeStream: {
          turnId,
          segmentStatus: 'paused',
          update: {
            content: pausedContent,
            status: toolResponseStatus(),
          },
        },
        groupRootBaseline: [],
      });

      const messages = projectSessionMessages(snapshot);
      expect(collectPendingToolResponses(messages)).toHaveLength(0);
    });
  });

  describe('ask-user live continuation projection', () => {
    it('scopes activeStream to the current group when a continuation turn completes', () => {
      const fold = new PeerThreadFoldState();

      ingestTurnEvent(
        fold,
        modelMessage({
          id: 'model-1',
          threadId: ROOT_THREAD_ID,
          toolCalls: [
            {
              id: 'question-1',
              type: 'function',
              function: {
                name: 'ask_user_question',
                arguments: JSON.stringify({
                  question: 'What would you like help with?',
                  options: ['Help with a coding task'],
                }),
              },
              toolInfo: {
                type: 'trueforge-system',
                name: 'ask_user_question',
              },
            },
          ],
        }),
      );
      ingestTurnEvent(
        fold,
        responseRequired({
          id: 'resp-req-1',
          threadId: ROOT_THREAD_ID,
          toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
        }),
      );
      applyUserToolResponsesToFold(fold, [
        {
          type: 'user.tool_response',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'question-1',
          content: 'Help with a coding task',
        },
      ]);
      ingestTurnEvent(
        fold,
        modelMessage({
          id: 'model-2',
          threadId: ROOT_THREAD_ID,
          content: 'Group 1 follow-up',
        }),
      );

      ingestTurnEvent(
        fold,
        modelMessage({
          id: 'model-3',
          threadId: ROOT_THREAD_ID,
          toolCalls: [
            {
              id: 'question-2',
              type: 'function',
              function: {
                name: 'ask_user_question',
                arguments: JSON.stringify({
                  question: 'What kind of code?',
                  options: ['Write new code'],
                }),
              },
              toolInfo: {
                type: 'trueforge-system',
                name: 'ask_user_question',
              },
            },
          ],
        }),
      );
      ingestTurnEvent(
        fold,
        responseRequired({
          id: 'resp-req-2',
          threadId: ROOT_THREAD_ID,
          toolCalls: [{ id: 'question-2', sourceEventId: 'model-3' }],
        }),
      );
      applyUserToolResponsesToFold(fold, [
        {
          type: 'user.tool_response',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'question-2',
          content: 'Write new code',
        },
      ]);
      ingestTurnEvent(
        fold,
        modelMessage({
          id: 'model-4',
          threadId: ROOT_THREAD_ID,
          content: 'Group 2 follow-up',
        }),
      );

      const snapshot = replaceSessionSnapshot(createEmptySessionSnapshot(), {
        fold,
        groupRootBaseline: ['model-1', 'model-2'],
        turns: [
          {
            id: 'turn-1',
            createdAt,
            userText: 'ask me a question',
            state: {
              status: 'done',
              requiredActions: [],
              completedAt: createdAt,
            },
            input: [{ type: 'user.message', content: 'ask me a question' }],
            rootModelMessageIds: ['model-1'],
          },
          {
            id: 'turn-2',
            createdAt,
            state: {
              status: 'done',
              requiredActions: [],
              completedAt: createdAt,
            },
            input: [
              {
                type: 'user.tool_response',
                threadId: ROOT_THREAD_ID,
                toolCallId: 'question-1',
                content: 'Help with a coding task',
              },
            ],
            rootModelMessageIds: ['model-2'],
          },
          {
            id: 'turn-3',
            createdAt,
            userText: 'ask again',
            state: {
              status: 'done',
              requiredActions: [],
              completedAt: createdAt,
            },
            input: [{ type: 'user.message', content: 'ask again' }],
            rootModelMessageIds: ['model-3'],
          },
        ],
        activeStream: {
          turnId: 'turn-3',
          segmentStatus: 'paused',
          update: {
            content: [{ type: 'text', text: 'Group 2 follow-up' }],
            status: { type: 'complete', reason: 'stop' },
          },
        },
      });

      const messages = projectSessionMessages(snapshot);
      expect(messages).toHaveLength(4);

      const group1Assistant = messages[1];
      const group2Assistant = messages[3];
      expect(group1Assistant?.role).toBe('assistant');
      expect(group2Assistant?.role).toBe('assistant');
      if (group1Assistant?.role !== 'assistant' || group2Assistant?.role !== 'assistant') {
        return;
      }

      const group1Texts = group1Assistant.content.filter(part => part.type === 'text').map(part => part.text);
      const group2Texts = group2Assistant.content.filter(part => part.type === 'text').map(part => part.text);

      expect(group1Texts).toContain('Group 1 follow-up');
      expect(group1Texts).not.toContain('Group 2 follow-up');
      expect(group2Texts).toContain('Group 2 follow-up');
      expect(group2Texts).not.toContain('Group 1 follow-up');

      const group2ToolCalls = group2Assistant.content.filter(part => part.type === 'tool-call');
      expect(group2ToolCalls).toHaveLength(1);
      expect(group2ToolCalls[0]).toMatchObject({
        toolCallId: 'question-2',
        result: 'Write new code',
      });
    });
  });
});

// ---------------------------------------------------------------------------
// buildSnapshotFromSessionEvents
// ---------------------------------------------------------------------------

/** Simulates session.listEvents — returns items in desc order (newest first). */
function sessionEventsPage(items: SessionEventItem[], options?: { pageSize?: number }) {
  return async (opts?: { sessionId?: string; lastTurnId?: string; pageToken?: string; limit?: number }) => {
    let filtered = items;
    if (opts?.lastTurnId != null) {
      // Chronological items: keep through lastTurnId, drop later turns.
      const lastIndex = filtered.findLastIndex(item => item.turnId === opts.lastTurnId);
      filtered = lastIndex === -1 ? [] : filtered.slice(0, lastIndex + 1);
    }
    const newestFirst = [...filtered].reverse();
    // Prefer fixture pageSize so pagination tests are not forced to the API default limit.
    const pageSize = options?.pageSize ?? opts?.limit ?? (newestFirst.length || 1);
    const pageIndex = opts?.pageToken != null ? Number(opts.pageToken) : 0;
    const start = pageIndex * pageSize;
    const slice = newestFirst.slice(start, start + pageSize);
    const hasMore = start + pageSize < newestFirst.length;
    const nextPageToken = hasMore ? String(pageIndex + 1) : undefined;
    return {
      data: slice,
      ...(nextPageToken != null ? { nextPageToken } : {}),
    };
  };
}

/** Builds a mock AgentChatServer with listTurns and listEvents. */
function mockServerWithEvents(turns: Turn[], eventItems: SessionEventItem[]): AgentChatServer {
  return {
    listTurns: async ({ limit }: { limit?: number } = {}) => ({
      data: limit != null ? turns.slice(0, limit) : turns,
    }),
    listEvents: sessionEventsPage(eventItems),
    listTurnEvents: async () => ({ data: [] }),
  } as unknown as AgentChatServer;
}

describe('buildSnapshotFromSessionEvents', () => {
  it('builds a snapshot from a single complete turn', async () => {
    const turnStartedAt = '2026-09-15T09:00:00.000Z';
    const turnCompletedAt = '2026-09-15T09:00:12.000Z';
    const items: SessionEventItem[] = [
      {
        turnId: 't1',
        event: {
          type: 'turn.created',
          id: 'evt-c1',
          turnId: 't1',
          input: [{ type: 'user.message', content: 'hello' }],
          state: { status: 'running' },
          createdAt: turnStartedAt,
        },
      },
      {
        turnId: 't1',
        event: modelMessage({ id: 'm1', threadId: ROOT_THREAD_ID, content: 'hi there' }),
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.done',
          id: 'evt-d1',
          state: { status: 'done', requiredActions: [], completedAt: turnCompletedAt },
          createdAt: turnCompletedAt,
        } as TurnDoneEvent,
      },
    ];

    const snapshot = await buildSnapshotFromSessionEvents(mockServerWithEvents([], items), SESSION_ID);

    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]?.id).toBe('t1');
    expect(snapshot.turns[0]?.userText).toBe('hello');
    expect(snapshot.turns[0]?.state).toEqual({
      status: 'done',
      requiredActions: [],
      completedAt: turnCompletedAt,
    });
    expect(snapshot.turns[0]?.rootModelMessageIds).toEqual(['m1']);
    expect(snapshot.activeTurn).toBeUndefined();

    const messages = projectSessionMessages(snapshot);
    expect(messages).toHaveLength(2);
    expect(messages[0]?.role).toBe('user');
    expect(messages[0]?.createdAt).toEqual(new Date(turnStartedAt));
    expect(messages[1]?.role).toBe('assistant');
    expect(messages[1]?.createdAt).toEqual(new Date(turnCompletedAt));
  });

  it('detects and attaches the running turn without events', async () => {
    const runningTurn = {
      id: 't2',
      state: { status: 'running' },
      input: [{ type: 'user.message', content: 'in progress' }],
      createdAt,
    } as unknown as Turn;

    const items: SessionEventItem[] = [
      {
        turnId: 't1',
        event: {
          type: 'turn.created',
          id: 'evt-c1',
          turnId: 't1',
          input: [{ type: 'user.message', content: 'first' }],
          state: { status: 'running' },
          createdAt,
        },
      },
      {
        turnId: 't1',
        event: modelMessage({ id: 'm1', threadId: ROOT_THREAD_ID, content: 'reply 1' }),
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.done',
          id: 'evt-d1',
          state: { status: 'done', requiredActions: [], completedAt: createdAt },
          createdAt,
        } as TurnDoneEvent,
      },
      // t2 (running) has no events — it is excluded from session-level listEvents
    ];

    const snapshot = await buildSnapshotFromSessionEvents(mockServerWithEvents([runningTurn], items), SESSION_ID);

    expect(snapshot.turns).toHaveLength(1);
    expect(snapshot.turns[0]?.id).toBe('t1');
    expect(snapshot.activeTurn).toBe(runningTurn);
    expect(snapshot.unstable_resume).toBe(true);
    expect(snapshot.groupRootBaseline).toBeDefined();
    expect(snapshot.pendingUser).toMatchObject({
      turnId: 't2',
      content: 'in progress',
    });
  });

  it('rehydrates an open paused tip on the same turn id', async () => {
    const pausedTurn: Turn = {
      id: 't-paused',
      sessionId: SESSION_ID,
      state: {
        status: 'paused',
        actionRequiredOnEvents: [{ id: 'approval-required-1' }],
        pausedAt: createdAt,
      },
      input: [{ type: 'user.message', content: 'run it' }],
      createdAt,
    };
    const items: SessionEventItem[] = [
      {
        turnId: pausedTurn.id,
        event: {
          type: 'turn.created',
          id: 'created-paused',
          turnId: pausedTurn.id,
          input: [{ type: 'user.message', content: 'run it' }],
          state: { status: 'running' },
          createdAt,
        },
      },
      {
        turnId: pausedTurn.id,
        event: modelMessage({
          id: 'model-paused',
          threadId: ROOT_THREAD_ID,
          toolCalls: [
            {
              id: 'approval-1',
              type: 'function',
              function: { name: 'bash', arguments: '{}' },
            },
          ],
        }),
      },
      {
        turnId: pausedTurn.id,
        event: approvalRequired({
          id: 'approval-required-1',
          threadId: ROOT_THREAD_ID,
          toolCalls: [{ id: 'approval-1', sourceEventId: 'model-paused' }],
        }),
      },
      {
        turnId: pausedTurn.id,
        event: {
          type: 'turn.update',
          id: 'paused-update',
          createdAt,
          threadId: null,
          state: {
            status: 'paused',
            actionRequiredOnEvents: [{ id: 'approval-required-1' }],
            pausedAt: createdAt,
          },
        },
      },
    ];

    const snapshot = await buildSnapshotFromSessionEvents(mockServerWithEvents([pausedTurn], items), SESSION_ID);

    expect(snapshot.turns).toHaveLength(0);
    expect(snapshot.activeTurn).toEqual(pausedTurn);
    expect(snapshot.pendingUser).toMatchObject({ turnId: pausedTurn.id, content: 'run it' });
    expect(snapshot.unstable_resume).toBe(true);
    const messages = projectSessionMessages(snapshot);
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({
      role: 'assistant',
      status: { type: 'requires-action', reason: 'tool-calls' },
      metadata: { custom: { turnId: pausedTurn.id } },
    });
    expect(collectPendingApprovals(messages)).toMatchObject([{ approvalId: 'approval-1', threadId: ROOT_THREAD_ID }]);
  });

  it('rehydrates pending MCP auth before subscription replay', async () => {
    const pausedTurn: Turn = {
      id: 't-mcp-paused',
      sessionId: SESSION_ID,
      state: {
        status: 'paused',
        actionRequiredOnEvents: [{ id: 'mcp-auth-1' }],
        pausedAt: createdAt,
      },
      input: [{ type: 'user.message', content: 'use github' }],
      createdAt,
    };
    const items: SessionEventItem[] = [
      {
        turnId: pausedTurn.id,
        event: {
          type: 'turn.created',
          id: 'created-mcp',
          turnId: pausedTurn.id,
          input: [{ type: 'user.message', content: 'use github' }],
          state: { status: 'running' },
          createdAt,
        },
      },
      {
        turnId: pausedTurn.id,
        event: modelMessage({ id: 'model-mcp', threadId: ROOT_THREAD_ID, content: 'Connecting' }),
      },
      {
        turnId: pausedTurn.id,
        event: {
          type: 'mcp.auth_required',
          id: 'mcp-auth-1',
          createdAt,
          threadId: null,
          mcpServers: [{ id: 'github', name: 'GitHub', authUrl: 'https://example.com/auth' }],
        },
      },
      {
        turnId: pausedTurn.id,
        event: {
          type: 'turn.update',
          id: 'paused-mcp',
          createdAt,
          threadId: null,
          state: {
            status: 'paused',
            actionRequiredOnEvents: [{ id: 'mcp-auth-1' }],
            pausedAt: createdAt,
          },
        },
      },
    ];

    const snapshot = await buildSnapshotFromSessionEvents(mockServerWithEvents([pausedTurn], items), SESSION_ID);
    const messages = projectSessionMessages(snapshot);

    expect(messages.at(-1)).toMatchObject({
      role: 'assistant',
      status: { type: 'requires-action', reason: 'interrupt' },
    });
    expect(derivePendingMcpAuth(messages)).toEqual({
      mcpServers: [{ id: 'github', name: 'GitHub', authUrl: 'https://example.com/auth' }],
    });
  });

  it('calls onProgress after each completed turn', async () => {
    const items: SessionEventItem[] = [
      {
        turnId: 't1',
        event: {
          type: 'turn.created',
          id: 'evt-c1',
          turnId: 't1',
          input: [{ type: 'user.message', content: 'first' }],
          state: { status: 'running' },
          createdAt,
        },
      },
      {
        turnId: 't1',
        event: modelMessage({ id: 'm1', threadId: ROOT_THREAD_ID, content: 'reply 1' }),
      },
      {
        turnId: 't1',
        event: {
          type: 'turn.done',
          id: 'evt-d1',
          state: { status: 'done', requiredActions: [], completedAt: createdAt },
          createdAt,
        } as TurnDoneEvent,
      },
      {
        turnId: 't2',
        event: {
          type: 'turn.created',
          id: 'evt-c2',
          turnId: 't2',
          input: [{ type: 'user.message', content: 'second' }],
          state: { status: 'running' },
          createdAt,
        },
      },
      {
        turnId: 't2',
        event: modelMessage({ id: 'm2', threadId: ROOT_THREAD_ID, content: 'reply 2' }),
      },
      {
        turnId: 't2',
        event: {
          type: 'turn.done',
          id: 'evt-d2',
          state: { status: 'done', requiredActions: [], completedAt: createdAt },
          createdAt,
        } as TurnDoneEvent,
      },
    ];

    const progressSnapshots: number[] = [];
    await buildSnapshotFromSessionEvents(mockServerWithEvents([], items), SESSION_ID, snap =>
      progressSnapshots.push(snap.turns.length),
    );

    expect(progressSnapshots).toEqual([1, 2]);
  });

  it('falls back to listTurns({ limit: 1 }) when listEvents omits the running tip', async () => {
    const listTurns = vi.fn(async () => ({
      data: [
        {
          id: 't-running',
          sessionId: SESSION_ID,
          state: { status: 'running' },
          input: [{ type: 'user.message', content: 'now' }],
          createdAt,
        },
      ],
      nextPageToken: 'more',
    }));

    const server = {
      listTurns,
      listEvents: sessionEventsPage([]),
      listTurnEvents: async () => ({ data: [] }),
    } as unknown as AgentChatServer;

    const snapshot = await buildSnapshotFromSessionEvents(server, SESSION_ID);
    expect(listTurns).toHaveBeenCalledWith({ sessionId: SESSION_ID, limit: 1 });
    expect(snapshot.activeTurn?.id).toBe('t-running');
    expect(snapshot.pendingUser?.content).toBe('now');
  });

  it('attaches an open tip from events when listTurns is oldest-first and clears answered ask-user', async () => {
    // Trueforge listTurns is ASC: limit:1 returns the oldest done turn even
    // while a later tip is still running. Tip detection must use the open
    // turn.created in listEvents (which includes running turns).
    const oldestDoneTurn = {
      id: 't-pause',
      sessionId: SESSION_ID,
      state: {
        status: 'done',
        requiredActions: [
          {
            id: 'resp-req-1',
            type: 'tool.response_required',
            threadId: ROOT_THREAD_ID,
            createdAt,
            toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
          },
        ],
        completedAt: createdAt,
      },
      input: [{ type: 'user.message', content: 'please research' }],
      createdAt,
    } as unknown as Turn;

    const runningTip = {
      id: 't-running',
      sessionId: SESSION_ID,
      state: { status: 'running' },
      input: [
        {
          type: 'user.tool_response',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'question-1',
          content: 'AI-native / LLM-powered SaaS',
        },
      ],
      createdAt,
    } as unknown as Turn;

    const items: SessionEventItem[] = [
      {
        turnId: 't-pause',
        event: {
          type: 'turn.created',
          id: 'evt-c-pause',
          turnId: 't-pause',
          ...(oldestDoneTurn.input === undefined ? {} : { input: oldestDoneTurn.input }),
          state: { status: 'running' },
          createdAt,
        },
      },
      {
        turnId: 't-pause',
        event: modelMessage({
          id: 'model-1',
          threadId: ROOT_THREAD_ID,
          content: 'One calibration question:',
          toolCalls: [
            {
              id: 'question-1',
              type: 'function',
              function: {
                name: 'ask_user_question',
                arguments: JSON.stringify({
                  question: 'Which direction should I focus on?',
                  options: ['General B2B SaaS', 'AI-native / LLM-powered SaaS'],
                }),
              },
              toolInfo: {
                type: 'trueforge-system',
                name: 'ask_user_question',
              },
            },
          ],
        }),
      },
      {
        turnId: 't-pause',
        event: responseRequired({
          id: 'resp-req-1',
          threadId: ROOT_THREAD_ID,
          toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
        }),
      },
      {
        turnId: 't-pause',
        event: {
          type: 'turn.done',
          id: 'evt-d-pause',
          state: oldestDoneTurn.state as TurnDoneEvent['state'],
          createdAt,
        } as TurnDoneEvent,
      },
      {
        turnId: 't-running',
        event: {
          type: 'turn.created',
          id: 'evt-c-running',
          turnId: 't-running',
          previousTurnId: 't-pause',
          ...(runningTip.input === undefined ? {} : { input: runningTip.input }),
          state: { status: 'running' },
          createdAt,
        },
      },
      {
        turnId: 't-running',
        event: modelMessage({
          id: 'model-2',
          threadId: ROOT_THREAD_ID,
          content: 'Locked in — starting deep research.',
        }),
      },
    ];

    const listTurns = vi.fn(async () => ({
      data: [oldestDoneTurn],
      nextPageToken: 'eyJvZmZzZXQiOjF9',
    }));
    const getTurn = vi.fn(async () => runningTip);
    const server = {
      listTurns,
      getTurn,
      listEvents: sessionEventsPage(items),
      listTurnEvents: async () => ({ data: [] }),
    } as unknown as AgentChatServer;

    const snapshot = await buildSnapshotFromSessionEvents(server, SESSION_ID);

    expect(getTurn).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      turnId: 't-running',
    });
    expect(listTurns).not.toHaveBeenCalled();
    expect(snapshot.activeTurn?.id).toBe('t-running');
    expect(snapshot.unstable_resume).toBe(true);

    const messages = projectSessionMessages(snapshot);
    expect(collectPendingToolResponses(messages)).toHaveLength(0);

    const assistant = messages.find(message => message.role === 'assistant');
    expect(assistant).toBeDefined();
    const toolCall = assistant?.content.find(part => part.type === 'tool-call' && part.toolCallId === 'question-1');
    expect(toolCall).toMatchObject({
      type: 'tool-call',
      toolCallId: 'question-1',
      result: 'AI-native / LLM-powered SaaS',
    });
    if (toolCall?.type === 'tool-call') {
      expect(toolCall.interrupt).toBeUndefined();
    }
  });

  it('keeps an answered ask-user answered when the open tip finished before getTurn', async () => {
    // The tip can complete between listEvents and getTurn. There is nothing
    // left to resume, but its user.tool_response input never reached the
    // fold via ingestion (no turn.done in the window), so it must still be
    // applied — otherwise the answered prompt resurfaces as pending.
    const finishedTip = {
      id: 't-tip',
      sessionId: SESSION_ID,
      state: { status: 'done', requiredActions: [], completedAt: createdAt },
      input: [
        {
          type: 'user.tool_response',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'question-1',
          content: 'AI-native / LLM-powered SaaS',
        },
      ],
      createdAt,
    } as unknown as Turn;

    const items: SessionEventItem[] = [
      {
        turnId: 't-pause',
        event: {
          type: 'turn.created',
          id: 'evt-c-pause',
          turnId: 't-pause',
          input: [{ type: 'user.message', content: 'please research' }],
          state: { status: 'running' },
          createdAt,
        },
      },
      {
        turnId: 't-pause',
        event: modelMessage({
          id: 'model-1',
          threadId: ROOT_THREAD_ID,
          content: 'One calibration question:',
          toolCalls: [
            {
              id: 'question-1',
              type: 'function',
              function: {
                name: 'ask_user_question',
                arguments: JSON.stringify({
                  question: 'Which direction should I focus on?',
                  options: ['General B2B SaaS', 'AI-native / LLM-powered SaaS'],
                }),
              },
              toolInfo: {
                type: 'trueforge-system',
                name: 'ask_user_question',
              },
            },
          ],
        }),
      },
      {
        turnId: 't-pause',
        event: responseRequired({
          id: 'resp-req-1',
          threadId: ROOT_THREAD_ID,
          toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
        }),
      },
      {
        turnId: 't-pause',
        event: {
          type: 'turn.done',
          id: 'evt-d-pause',
          state: {
            status: 'done',
            requiredActions: [
              {
                id: 'resp-req-1',
                type: 'tool.response_required',
                threadId: ROOT_THREAD_ID,
                createdAt,
                toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
              },
            ],
            completedAt: createdAt,
          },
          createdAt,
        } as unknown as TurnDoneEvent,
      },
      {
        turnId: 't-tip',
        event: {
          type: 'turn.created',
          id: 'evt-c-tip',
          turnId: 't-tip',
          previousTurnId: 't-pause',
          ...(finishedTip.input === undefined ? {} : { input: finishedTip.input }),
          state: { status: 'running' },
          createdAt,
        },
      },
    ];

    const listTurns = vi.fn(async () => ({ data: [], nextPageToken: undefined }));
    const getTurn = vi.fn(async () => finishedTip);
    const server = {
      listTurns,
      getTurn,
      listEvents: sessionEventsPage(items),
      listTurnEvents: async () => ({ data: [] }),
    } as unknown as AgentChatServer;

    const snapshot = await buildSnapshotFromSessionEvents(server, SESSION_ID);

    expect(snapshot.activeTurn).toBeUndefined();
    expect(snapshot.unstable_resume).toBeFalsy();

    const messages = projectSessionMessages(snapshot);
    expect(collectPendingToolResponses(messages)).toHaveLength(0);

    const assistant = messages.find(message => message.role === 'assistant');
    const toolCall = assistant?.content.find(part => part.type === 'tool-call' && part.toolCallId === 'question-1');
    expect(toolCall).toMatchObject({
      type: 'tool-call',
      toolCallId: 'question-1',
      result: 'AI-native / LLM-powered SaaS',
    });
    if (toolCall?.type === 'tool-call') {
      expect(toolCall.interrupt).toBeUndefined();
    }
  });

  it('loads only the newest event page and exposes an older-history cursor', async () => {
    const makeTurnItems = (id: string, text: string): SessionEventItem[] => [
      {
        turnId: id,
        event: {
          type: 'turn.created',
          id: `evt-c-${id}`,
          turnId: id,
          input: [{ type: 'user.message', content: text }],
          state: { status: 'running' },
          createdAt,
        },
      },
      {
        turnId: id,
        event: modelMessage({
          id: `m-${id}`,
          threadId: ROOT_THREAD_ID,
          content: `reply ${text}`,
        }),
      },
      {
        turnId: id,
        event: {
          type: 'turn.done',
          id: `evt-d-${id}`,
          state: { status: 'done', requiredActions: [], completedAt: createdAt },
          createdAt,
        } as TurnDoneEvent,
      },
    ];

    // 3 events per turn; pageSize 3 → one turn per page (newest first).
    const items = [...makeTurnItems('t1', 'first'), ...makeTurnItems('t2', 'second'), ...makeTurnItems('t3', 'third')];
    const listEvents = sessionEventsPage(items, { pageSize: 3 });
    const listEventsSpy = vi.fn(listEvents);
    const server = {
      listTurns: async () => ({ data: [] }),
      listEvents: listEventsSpy,
      listTurnEvents: async () => ({ data: [] }),
    } as unknown as AgentChatServer;

    const snapshot = await buildSnapshotFromSessionEvents(server, SESSION_ID);
    expect(listEventsSpy).toHaveBeenCalledTimes(1);
    expect(snapshot.turns.map(t => t.id)).toEqual(['t3']);
    expect(snapshot.historyPagination).toEqual({
      hasOlder: true,
      olderPageToken: '1',
    });

    const withOlder = await prependOlderSessionHistory(server, SESSION_ID, snapshot);
    expect(withOlder.turns.map(t => t.id)).toEqual(['t2', 't3']);
    expect(projectSessionMessages(withOlder).map(m => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    expect(withOlder.historyPagination?.hasOlder).toBe(true);

    const withAll = await prependOlderSessionHistory(server, SESSION_ID, withOlder);
    expect(withAll.turns.map(t => t.id)).toEqual(['t1', 't2', 't3']);
    expect(withAll.historyPagination?.hasOlder).toBe(false);
  });

  it('backfills sandboxId onto tip turns after older history reveals sandbox.created', async () => {
    const makeTurnItems = (id: string, text: string, options?: { sandboxId?: string }): SessionEventItem[] => [
      {
        turnId: id,
        event: {
          type: 'turn.created',
          id: `evt-c-${id}`,
          turnId: id,
          input: [{ type: 'user.message', content: text }],
          state: { status: 'running' },
          createdAt,
        },
      },
      ...(options?.sandboxId != null
        ? [
            {
              turnId: id,
              event: sandboxCreated({
                id: `sandbox-${id}`,
                sandboxId: options.sandboxId,
              }),
            } satisfies SessionEventItem,
          ]
        : [
            {
              turnId: id,
              event: modelMessage({
                id: `m-${id}-pad`,
                threadId: ROOT_THREAD_ID,
                content: '…',
              }),
            } satisfies SessionEventItem,
          ]),
      {
        turnId: id,
        event: modelMessage({
          id: `m-${id}`,
          threadId: ROOT_THREAD_ID,
          content: `reply ${text}`,
        }),
      },
      {
        turnId: id,
        event: {
          type: 'turn.done',
          id: `evt-d-${id}`,
          state: { status: 'done', requiredActions: [], completedAt: createdAt },
          createdAt,
        } as TurnDoneEvent,
      },
    ];

    // 4 events per turn; pageSize 4 → tip-only first page (no sandbox.created).
    const items = [...makeTurnItems('t1', 'create', { sandboxId: 'sbx-123' }), ...makeTurnItems('t2', 'reuse')];
    const listEvents = sessionEventsPage(items, { pageSize: 4 });
    const server = {
      listTurns: async () => ({ data: [] }),
      listEvents,
      listTurnEvents: async () => ({ data: [] }),
    } as unknown as AgentChatServer;

    const tipOnly = await buildSnapshotFromSessionEvents(server, SESSION_ID);
    expect(tipOnly.turns.map(t => t.id)).toEqual(['t2']);
    expect(tipOnly.turns[0]?.sandboxId).toBeUndefined();
    const tipMessages = projectSessionMessages(tipOnly);
    expect(tipMessages.at(-1)).toMatchObject({
      role: 'assistant',
      metadata: { custom: { turnId: 't2' } },
    });
    expect((tipMessages.at(-1)?.metadata.custom as { sandboxId?: string }).sandboxId).toBeUndefined();

    const withCreate = await prependOlderSessionHistory(server, SESSION_ID, tipOnly);
    expect(withCreate.turns.map(t => t.id)).toEqual(['t1', 't2']);
    expect(withCreate.turns.map(t => t.sandboxId)).toEqual(['sbx-123', 'sbx-123']);
    expect(projectSessionMessages(withCreate).at(-1)).toMatchObject({
      role: 'assistant',
      metadata: { custom: { sandboxId: 'sbx-123', turnId: 't2' } },
    });
  });
});

describe('buildSnapshotThroughTurn', () => {
  /** Linear session t1 -> t2 -> t3, oldest-first. */
  function linearTurns(): TurnFixture[] {
    return [
      mockTurn({
        id: 't1',
        createdAt: '2026-01-01T00:00:00.000Z',
        previousTurnId: null,
        input: [{ type: 'user.message', content: 'first' }],
        events: [modelMessage({ id: 'm1', threadId: ROOT_THREAD_ID, content: 'reply 1' })],
      }),
      mockTurn({
        id: 't2',
        createdAt: '2026-01-01T00:01:00.000Z',
        previousTurnId: 't1',
        input: [{ type: 'user.message', content: 'second' }],
        events: [modelMessage({ id: 'm2', threadId: ROOT_THREAD_ID, content: 'reply 2' })],
      }),
      mockTurn({
        id: 't3',
        createdAt: '2026-01-01T00:02:00.000Z',
        previousTurnId: 't2',
        input: [{ type: 'user.message', content: 'third' }],
        events: [modelMessage({ id: 'm3', threadId: ROOT_THREAD_ID, content: 'reply 3' })],
      }),
    ];
  }

  it("rewinds to the anchor's ancestor chain, inclusive", async () => {
    const server = mockServerWithTurns(linearTurns());
    const snapshot = await buildSnapshotThroughTurn(server, SESSION_ID, 't2');

    expect(snapshot.turns.map(turn => turn.id)).toEqual(['t1', 't2']);
    expect(projectSessionMessages(snapshot).map(message => message.id)).toEqual([
      't1-user',
      't1-assistant',
      't2-user',
      't2-assistant',
    ]);
  });

  it('returns an empty snapshot for a null anchor (branching from a root turn)', async () => {
    const server = mockServerWithTurns(linearTurns());
    const snapshot = await buildSnapshotThroughTurn(server, SESSION_ID, null);
    expect(snapshot.turns).toHaveLength(0);
  });

  it('ignores listTurns page order', async () => {
    const asc = linearTurns();
    const ascSnapshot = await buildSnapshotThroughTurn(mockServerWithTurns(asc), SESSION_ID, 't2');
    const descSnapshot = await buildSnapshotThroughTurn(mockServerWithTurns([...asc].reverse()), SESSION_ID, 't2');

    expect(descSnapshot.turns.map(turn => turn.id)).toEqual(ascSnapshot.turns.map(turn => turn.id));
    expect(descSnapshot.turns.map(turn => turn.id)).toEqual(['t1', 't2']);
  });

  it('drops sibling turns left behind by an earlier rerun', async () => {
    // m2/m3 were rerun once already: t2/t3 are orphans, t2p/t3p are live.
    const [t1, t2, t3] = linearTurns();
    const t2p = mockTurn({
      id: 't2p',
      createdAt: '2026-01-01T00:03:00.000Z',
      previousTurnId: 't1',
      input: [{ type: 'user.message', content: 'second again' }],
      events: [modelMessage({ id: 'm2p', threadId: ROOT_THREAD_ID, content: 'reply 2p' })],
    });
    const t3p = mockTurn({
      id: 't3p',
      createdAt: '2026-01-01T00:04:00.000Z',
      previousTurnId: 't2p',
      input: [{ type: 'user.message', content: 'third again' }],
      events: [modelMessage({ id: 'm3p', threadId: ROOT_THREAD_ID, content: 'reply 3p' })],
    });
    const server = mockServerWithTurns([t1!, t2!, t3!, t2p, t3p]);

    // Rerunning the middle live turn rewinds to its parent, not to the
    // chronologically preceding turn (t3), whose chain still holds t2/t3.
    const previousTurnId = await resolveGatewayBranchPreviousTurnIdForTurn(server, SESSION_ID, 't2p');
    expect(previousTurnId).toBe('t1');

    const snapshot = await buildSnapshotThroughTurn(server, SESSION_ID, previousTurnId);
    expect(snapshot.turns.map(turn => turn.id)).toEqual(['t1']);

    // The orphan chain is still reachable, so the assertion above is not
    // passing by accident.
    const orphanSnapshot = await buildSnapshotThroughTurn(server, SESSION_ID, 't3');
    expect(orphanSnapshot.turns.map(turn => turn.id)).toEqual(['t1', 't2', 't3']);
  });
});

describe('resolveGatewayBranchPreviousTurnIdForTurn', () => {
  it('uses the turn parent for subsequent turns and none for roots (ASC listTurns)', async () => {
    const t1 = mockTurn({
      id: 't1',
      createdAt: '2026-01-01T00:00:00.000Z',
      previousTurnId: null,
    });
    const t2 = mockTurn({
      id: 't2',
      createdAt: '2026-01-01T00:01:00.000Z',
      previousTurnId: 't1',
    });
    const t3 = mockTurn({
      id: 't3',
      createdAt: '2026-01-01T00:02:00.000Z',
      previousTurnId: 't2',
    });
    const server = mockServerWithTurns([t1, t2, t3]);

    await expect(resolveGatewayBranchPreviousTurnIdForTurn(server, SESSION_ID, 't1')).resolves.toBe('none');
    await expect(resolveGatewayBranchPreviousTurnIdForTurn(server, SESSION_ID, 't3')).resolves.toBe('t2');
  });

  it('uses the turn parent when listTurns is newest-first', async () => {
    const t1 = mockTurn({
      id: 't1',
      createdAt: '2026-01-01T00:00:00.000Z',
      previousTurnId: null,
    });
    const t2 = mockTurn({
      id: 't2',
      createdAt: '2026-01-01T00:01:00.000Z',
      previousTurnId: 't1',
    });
    const server = mockServerWithTurns([t2, t1]);

    await expect(resolveGatewayBranchPreviousTurnIdForTurn(server, SESSION_ID, 't2')).resolves.toBe('t1');
  });
});
