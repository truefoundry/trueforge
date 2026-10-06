// @vitest-environment jsdom
import type { ThreadMessage } from '@assistant-ui/core';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatServer, Turn } from '../src/server/index.js';

import { collectPendingToolResponses } from '../src/collectPending.js';
import { ROOT_THREAD_ID } from '../src/constants.js';
import {
  prependOlderSessionHistory,
  TurnFailedError,
  TurnStreamDisconnectedError,
} from '../src/convertTurnMessages.js';
import { buildRootAssistantContent, ingestTurnEvent, PeerThreadFoldState } from '../src/foldPeerThreads.js';
import { loadSessionSnapshot } from '../src/loadSessionSnapshot.js';
import { createEmptySessionSnapshot, replaceSessionSnapshot, type SessionSnapshot } from '../src/sessionSnapshot.js';
import { delayReconnect } from '../src/streamReconnect.js';
import { resumeTurnStream, streamTurnContent } from '../src/streamTurn.js';
import { messageHasPendingApprovals, TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY } from '../src/toolApproval.js';
import {
  messageHasPendingResponses,
  TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY,
  toolResponseMessageCustom,
  toolResponseStatus,
} from '../src/toolResponse.js';
import { useTrueForgeAgentMessages } from '../src/useTrueForgeAgentMessages.js';

vi.mock('../src/loadSessionSnapshot.js', () => ({
  loadSessionSnapshot: vi.fn(),
}));

vi.mock('../src/streamTurn.js', () => ({
  streamTurnContent: vi.fn(),
  resumeTurnStream: vi.fn(),
}));

vi.mock('../src/streamReconnect.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/streamReconnect.js')>();
  return {
    ...actual,
    delayReconnect: vi.fn(async (signal: AbortSignal) => {
      if (signal.aborted) {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      }
    }),
  };
});

vi.mock('../src/convertTurnMessages.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/convertTurnMessages.js')>();
  // Wrapped so tests can stub older-history paging; defaults to the real one.
  return {
    ...actual,
    prependOlderSessionHistory: vi.fn(actual.prependOlderSessionHistory),
  };
});

const mockServer = {
  cancelSession: vi.fn().mockResolvedValue(undefined),
  listTurns: vi.fn(),
  getTurn: vi.fn(),
  // Present so resume-capable paths are exercised; resumeTurnStream is mocked.
  subscribeToTurn: vi.fn(),
} as unknown as AgentChatServer;

function snapshotWithAssistantMessage(
  message: Extract<ThreadMessage, { role: 'assistant' }>,
  extra?: Partial<SessionSnapshot>,
): SessionSnapshot {
  const turnId = message.id.replace(/-assistant$/, '');
  return replaceSessionSnapshot(createEmptySessionSnapshot(), {
    activeStream: {
      turnId,
      isContinuation: false,
      update: {
        content: [...message.content],
        status: message.status,
        metadata: { custom: message.metadata.custom },
      },
    },
    ...extra,
  });
}

function snapshotWithUserTurn(userText: string): SessionSnapshot {
  const createdAt = new Date().toISOString();
  return replaceSessionSnapshot(createEmptySessionSnapshot(), {
    turns: [
      {
        id: 'turn-1',
        userText,
        createdAt,
        state: {
          status: 'done',
          requiredActions: [],
          completedAt: createdAt,
        },
        input: [{ type: 'user.message', content: userText }],
      },
    ],
  });
}

function snapshotWithAskUserPendingInFold(): SessionSnapshot {
  const fold = new PeerThreadFoldState();
  const turnId = 'turn-ask';

  ingestTurnEvent(fold, {
    type: 'model.message',
    id: 'model-1',
    createdAt: new Date().toISOString(),
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
        toolInfo: { type: 'trueforge-system', name: 'ask_user_question' },
      },
    ],
  });

  ingestTurnEvent(fold, {
    type: 'tool.response_required',
    id: 'resp-req-1',
    createdAt: new Date().toISOString(),
    threadId: ROOT_THREAD_ID,
    toolCalls: [{ id: 'question-1', sourceEventId: 'model-1' }],
  });

  const content = buildRootAssistantContent(fold);

  return replaceSessionSnapshot(createEmptySessionSnapshot(), {
    fold,
    pendingUser: {
      turnId,
      content: 'ask me a question',
      createdAt: new Date(),
    },
    activeStream: {
      turnId,
      isContinuation: false,
      streamComplete: true,
      update: {
        content,
        status: toolResponseStatus(),
        metadata: { custom: toolResponseMessageCustom(ROOT_THREAD_ID) },
      },
    },
  });
}

function assistantMessageWithPendingApproval() {
  return {
    id: 'turn-1-assistant',
    role: 'assistant' as const,
    content: [
      {
        type: 'tool-call' as const,
        toolCallId: 'approval-1',
        toolName: 'bash',
        args: {},
        argsText: '{}',
        approval: { id: 'approval-1' },
      },
    ],
    status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
    createdAt: new Date(),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { [TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY]: ROOT_THREAD_ID },
    },
  };
}

function assistantMessageWithPendingApprovalAndResponse() {
  return {
    id: 'turn-1-assistant',
    role: 'assistant' as const,
    content: [
      {
        type: 'tool-call' as const,
        toolCallId: 'approval-1',
        toolName: 'bash',
        args: {},
        argsText: '{}',
        approval: { id: 'approval-1' },
      },
      {
        type: 'tool-call' as const,
        toolCallId: 'question-1',
        toolName: 'ask_user_question',
        args: {},
        argsText: '{}',
        interrupt: {
          type: 'human' as const,
          payload: { question: 'Pick one', options: ['A', 'B'] },
        },
      },
    ],
    status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
    createdAt: new Date(),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        [TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY]: ROOT_THREAD_ID,
        [TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY]: ROOT_THREAD_ID,
      },
    },
  };
}

function assistantMessageWithMultiThreadPendingActions() {
  return {
    id: 'turn-1-assistant',
    role: 'assistant' as const,
    content: [
      {
        type: 'tool-call' as const,
        toolCallId: 'spawn-1',
        toolName: 'create_sub_agent',
        args: {},
        argsText: '{}',
        messages: [
          {
            id: 'child-assistant',
            role: 'assistant' as const,
            content: [
              {
                type: 'tool-call' as const,
                toolCallId: 'question-sub',
                toolName: 'ask_user_question',
                args: {},
                argsText: '{}',
                interrupt: {
                  type: 'human' as const,
                  payload: { question: 'Sub?' },
                },
              },
            ],
            status: {
              type: 'requires-action' as const,
              reason: 'tool-calls' as const,
            },
            createdAt: new Date(),
            metadata: {
              unstable_state: null,
              unstable_annotations: [],
              unstable_data: [],
              steps: [],
              custom: { [TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY]: 'child-1' },
            },
          },
        ],
      },
      {
        type: 'tool-call' as const,
        toolCallId: 'approval-root',
        toolName: 'bash',
        args: {},
        argsText: '{}',
        approval: { id: 'approval-root' },
      },
    ],
    status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
    createdAt: new Date(),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: { [TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY]: ROOT_THREAD_ID },
    },
  };
}

async function* singleUpdateStream() {
  yield { content: [{ type: 'text' as const, text: 'streamed reply' }] };
}

describe('useTrueForgeAgentMessages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(mockServer.cancelSession).mockResolvedValue(undefined);
    vi.mocked(mockServer.listTurns).mockResolvedValue({ data: [] });
    vi.mocked(loadSessionSnapshot).mockResolvedValue(createEmptySessionSnapshot());
    vi.mocked(streamTurnContent).mockReturnValue(singleUpdateStream());
    vi.mocked(resumeTurnStream).mockReturnValue(singleUpdateStream());
    vi.mocked(delayReconnect).mockImplementation(async (signal: AbortSignal) => {
      if (signal.aborted) {
        const error = new Error('Aborted');
        error.name = 'AbortError';
        throw error;
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clears messages when sessionId is undefined', async () => {
    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: undefined }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages).toEqual([]);
    expect(loadSessionSnapshot).not.toHaveBeenCalled();
  });

  it('loads the initial URL session before it is marked as the main thread', async () => {
    const { rerender } = renderHook(
      ({ isMain }: { isMain: boolean }) =>
        useTrueForgeAgentMessages({
          server: mockServer,
          sessionId: 'session-from-url',
          isMain,
          isInitialSession: true,
        }),
      { initialProps: { isMain: false } },
    );

    await waitFor(() =>
      expect(loadSessionSnapshot).toHaveBeenCalledWith(mockServer, 'session-from-url', expect.any(Function)),
    );

    rerender({ isMain: true });
    await act(async () => Promise.resolve());
    expect(loadSessionSnapshot).toHaveBeenCalledTimes(1);

    rerender({ isMain: false });
    rerender({ isMain: true });
    await waitFor(() => expect(loadSessionSnapshot).toHaveBeenCalledTimes(2));
  });

  it('does not load an inactive background thread', async () => {
    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'background-session',
        isMain: false,
        isInitialSession: false,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(loadSessionSnapshot).not.toHaveBeenCalled();
  });

  it('retries a failed URL early load before the thread is promoted to main', async () => {
    vi.mocked(loadSessionSnapshot)
      .mockRejectedValueOnce(new Error('load failed'))
      .mockResolvedValueOnce(snapshotWithUserTurn('Hello'));

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-from-url',
        isMain: false,
        isInitialSession: true,
      }),
    );

    await waitFor(() => expect(loadSessionSnapshot).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      result.current.retryLoad();
    });

    await waitFor(() => expect(loadSessionSnapshot).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(result.current.messages[0]).toMatchObject({
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
      }),
    );
  });

  it('sendTurn lazily initializes a session when sessionId is undefined', async () => {
    const initializeSession = vi.fn().mockResolvedValue({
      remoteId: 'session-new',
      externalId: undefined,
    });

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: undefined,
        initializeSession,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.sendTurn({ userMessage: 'hello there' });
    });

    expect(initializeSession).toHaveBeenCalledOnce();
    expect(streamTurnContent).toHaveBeenCalled();
    expect(loadSessionSnapshot).not.toHaveBeenCalled();
  });

  it('sendTurn forwards getTurnHeaders only when they resolve to a value', async () => {
    const getTurnHeaders = vi
      .fn()
      .mockResolvedValueOnce({
        'x-tfy-session-last-updated-at': '2026-06-30T12:00:00.000Z',
      })
      .mockResolvedValueOnce(undefined);

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        getTurnHeaders,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.sendTurn({ userMessage: 'first' });
    });

    expect(getTurnHeaders).toHaveBeenCalledTimes(1);
    expect(streamTurnContent).toHaveBeenCalledWith(
      mockServer,
      'session-1',
      expect.any(PeerThreadFoldState),
      {
        userMessage: 'first',
        previousTurnId: 'none',
        headers: {
          'x-tfy-session-last-updated-at': '2026-06-30T12:00:00.000Z',
        },
      },
      expect.any(AbortSignal),
      expect.any(Array),
      expect.any(Function),
      expect.any(Function),
    );

    await act(async () => {
      await result.current.sendTurn({ userMessage: 'second' });
    });

    expect(getTurnHeaders).toHaveBeenCalledTimes(2);
    expect(streamTurnContent).toHaveBeenLastCalledWith(
      mockServer,
      'session-1',
      expect.any(PeerThreadFoldState),
      { userMessage: 'second' },
      expect.any(AbortSignal),
      expect.any(Array),
      expect.any(Function),
      expect.any(Function),
    );
  });

  it('loads converted session history on mount', async () => {
    vi.mocked(loadSessionSnapshot).mockResolvedValue(snapshotWithUserTurn('hello'));

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(loadSessionSnapshot).toHaveBeenCalledWith(mockServer, 'session-1', expect.any(Function));
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.role).toBe('user');
  });

  it('resumes a running turn after load', async () => {
    const fold = new PeerThreadFoldState();
    ingestTurnEvent(fold, {
      type: 'model.message',
      id: 'model-resumed',
      createdAt: new Date().toISOString(),
      threadId: ROOT_THREAD_ID,
      content: 'streamed reply',
    });
    const runningTurn: Turn = {
      id: 'turn-running',
      sessionId: 'session-1',
      input: [{ type: 'user.message', content: 'continue' }],
      state: { status: 'running' },
      createdAt: new Date().toISOString(),
    };
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      replaceSessionSnapshot(createEmptySessionSnapshot(), {
        fold,
        turns: [
          {
            id: runningTurn.id,
            userText: 'continue',
            createdAt: new Date().toISOString(),
            state: { status: 'running' },
            input: [{ type: 'user.message', content: 'continue' }],
          },
        ],
        runningTurn,
        groupRootBaseline: [],
        unstable_resume: true,
      }),
    );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(resumeTurnStream).toHaveBeenCalled();
    await waitFor(() =>
      expect(result.current.messages.at(-1)).toMatchObject({
        role: 'assistant',
        content: [{ type: 'text', text: 'streamed reply' }],
        status: { type: 'complete', reason: 'stop' },
      }),
    );
  });

  it('shows loaded history as running when the server cannot resume the turn', async () => {
    const onError = vi.fn();
    const runningTurn = {
      id: 'turn-running',
      input: [{ type: 'user.message', content: 'keep going' }],
      createdAt: new Date().toISOString(),
    } as Turn;
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      replaceSessionSnapshot(createEmptySessionSnapshot(), {
        runningTurn,
        unstable_resume: true,
        pendingUser: {
          turnId: runningTurn.id,
          content: 'keep going',
          createdAt: new Date(runningTurn.createdAt),
        },
      }),
    );
    const serverWithoutSubscribe = {
      cancelSession: vi.fn().mockResolvedValue(undefined),
      listTurns: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as AgentChatServer;

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: serverWithoutSubscribe,
        sessionId: 'session-1',
        onError,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(resumeTurnStream).not.toHaveBeenCalled();
    // The turn keeps running server-side, so history renders with a
    // pending indicator rather than an endless skeleton.
    await waitFor(() => expect(result.current.isRunning).toBe(true));
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'keep going' }],
    });
    // Waiting, not failing: hosts render this as state, not an error.
    expect(result.current.resumeUnavailable).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('clears the running state when cancelling a turn it could not resume', async () => {
    const onError = vi.fn();
    const runningTurn: Turn = {
      id: 'turn-running',
      sessionId: 'session-1',
      input: [{ type: 'user.message', content: 'keep going' }],
      state: { status: 'running' },
      createdAt: new Date().toISOString(),
    };
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      replaceSessionSnapshot(createEmptySessionSnapshot(), {
        runningTurn,
        unstable_resume: true,
      }),
    );
    const serverWithoutSubscribe = {
      cancelSession: vi.fn().mockResolvedValue(undefined),
      listTurns: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as AgentChatServer;

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: serverWithoutSubscribe,
        sessionId: 'session-1',
        onError,
      }),
    );

    await waitFor(() => expect(result.current.isRunning).toBe(true));

    await act(async () => {
      await result.current.cancel();
    });

    expect(serverWithoutSubscribe.cancelSession).toHaveBeenCalledWith({
      sessionId: 'session-1',
    });
    // No stream was attached, so nothing else would release the composer.
    expect(result.current.isRunning).toBe(false);
    expect(result.current.resumeUnavailable).toBe(false);
  });

  it('stays in the waiting state instead of resuming when resumeRun has no subscribeToTurn', async () => {
    const onError = vi.fn();
    const runningTurn = { id: 'turn-running' } as Turn;
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      replaceSessionSnapshot(createEmptySessionSnapshot(), {
        runningTurn,
        unstable_resume: true,
      }),
    );
    const serverWithoutSubscribe = {
      cancelSession: vi.fn().mockResolvedValue(undefined),
      listTurns: vi.fn().mockResolvedValue({ data: [] }),
    } as unknown as AgentChatServer;

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: serverWithoutSubscribe,
        sessionId: 'session-1',
        onError,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    onError.mockClear();

    await act(async () => {
      await result.current.resumeRun();
    });

    expect(resumeTurnStream).not.toHaveBeenCalled();
    expect(result.current.resumeUnavailable).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it('clears isLoading while a resumed turn is still streaming', async () => {
    let releaseStream: (() => void) | undefined;
    vi.mocked(resumeTurnStream).mockReturnValue(
      (async function* () {
        await new Promise<void>(resolve => {
          releaseStream = resolve;
        });
        yield { content: [{ type: 'text' as const, text: 'streamed reply' }] };
      })(),
    );

    const runningTurn = {
      id: 'turn-running',
      input: [{ type: 'user.message', content: 'keep going' }],
      createdAt: new Date().toISOString(),
    } as Turn;
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      replaceSessionSnapshot(createEmptySessionSnapshot(), {
        runningTurn,
        unstable_resume: true,
        pendingUser: {
          turnId: runningTurn.id,
          content: 'keep going',
          createdAt: new Date(runningTurn.createdAt),
        },
      }),
    );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(resumeTurnStream).toHaveBeenCalled();
    await waitFor(() => expect(result.current.isRunning).toBe(true));
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'keep going' }],
    });

    await act(async () => {
      releaseStream?.();
    });
    await waitFor(() => expect(result.current.isRunning).toBe(false));
  });

  it('sendTurn appends a user message and streams the assistant reply', async () => {
    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.sendTurn({ userMessage: 'hello there' });
    });

    expect(streamTurnContent).toHaveBeenCalled();
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'hello there' }],
    });
    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'streamed reply' }],
      status: { type: 'complete', reason: 'stop' },
    });
  });

  it('editFromTurn drops prior turns before showing the edited user message', async () => {
    const createdAt = new Date().toISOString();
    const rootTurn = {
      id: 'turn-1',
      sessionId: 'session-1',
      createdAt,
      previousTurnId: null,
      state: {
        status: 'done' as const,
        requiredActions: [],
        completedAt: createdAt,
      },
      input: [{ type: 'user.message' as const, content: 'Hello' }],
    } as Turn;
    vi.mocked(mockServer.listTurns).mockResolvedValue({
      data: [rootTurn],
    });
    vi.mocked(mockServer.getTurn).mockResolvedValue(rootTurn);
    const fold = new PeerThreadFoldState();
    ingestTurnEvent(fold, {
      type: 'model.message',
      id: 'model-1',
      createdAt,
      threadId: ROOT_THREAD_ID,
      role: 'assistant',
      content: 'How are you',
    } as never);

    vi.mocked(loadSessionSnapshot).mockResolvedValue({
      ...replaceSessionSnapshot(createEmptySessionSnapshot(), {
        turns: [
          {
            id: 'turn-1',
            userText: 'Hello',
            createdAt,
            state: {
              status: 'done',
              requiredActions: [],
              completedAt: createdAt,
            },
            input: [{ type: 'user.message', content: 'Hello' }],
            rootModelMessageIds: ['model-1'],
          },
        ],
      }),
      fold,
    });
    let releaseStream: (() => void) | undefined;
    vi.mocked(streamTurnContent).mockReturnValue(
      (async function* () {
        yield {
          content: [{ type: 'text' as const, text: 'sunny' }],
        };
        await new Promise<void>(resolve => {
          releaseStream = resolve;
        });
      })(),
    );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.messages.map(m => m.role)).toEqual(['user', 'assistant']);
    expect(result.current.messages[0]).toMatchObject({
      content: [{ type: 'text', text: 'Hello' }],
    });

    let editPromise: Promise<void>;
    await act(async () => {
      editPromise = result.current.editFromTurn('turn-1', 'what is the weather like?');
      await Promise.resolve();
    });

    await waitFor(() => {
      const texts = result.current.messages
        .filter(m => m.role === 'user')
        .map(m =>
          m.content
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map(p => p.text)
            .join(''),
        );
      expect(texts).toEqual(['what is the weather like?']);
    });
    expect(
      result.current.messages.some(
        m => m.role === 'user' && m.content.some(p => p.type === 'text' && p.text === 'Hello'),
      ),
    ).toBe(false);
    expect(
      result.current.messages.some(
        m => m.role === 'assistant' && m.content.some(p => p.type === 'text' && p.text.includes('How are you')),
      ),
    ).toBe(false);

    await act(async () => {
      releaseStream?.();
      await editPromise!;
    });
  });

  it('restores history when edit fails before turn.created', async () => {
    const createdAt = new Date().toISOString();
    const onError = vi.fn();
    const original = snapshotWithUserTurn('Hello');
    vi.mocked(loadSessionSnapshot).mockResolvedValue(original);
    const rootTurn = {
      id: 'turn-1',
      sessionId: 'session-1',
      createdAt,
      previousTurnId: null,
      state: {
        status: 'done' as const,
        requiredActions: [],
        completedAt: createdAt,
      },
      input: [{ type: 'user.message' as const, content: 'Hello' }],
    } as Turn;
    vi.mocked(mockServer.listTurns).mockResolvedValue({
      data: [rootTurn],
    });
    vi.mocked(mockServer.getTurn).mockResolvedValue(rootTurn);
    vi.mocked(streamTurnContent).mockImplementation(async function* () {
      throw new Error('Turn preparation failed');
    });

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        onError,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.editFromTurn('turn-1', 'Edited')).rejects.toThrow('Turn preparation failed');
    });

    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]).toMatchObject({
      role: 'user',
      content: [{ type: 'text', text: 'Hello' }],
    });
    // runStream reports once; callers must not double-toast.
    expect(onError).toHaveBeenCalledOnce();
  });

  it('does not let a superseded stream complete the current stream', async () => {
    let releaseFirstStream: (() => void) | undefined;
    let releaseSecondStream: (() => void) | undefined;
    let nextAnimationFrame = 1;
    const animationFrames = new Map<number, FrameRequestCallback>();
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        const frame = nextAnimationFrame++;
        animationFrames.set(frame, callback);
        return frame;
      }),
    );
    vi.stubGlobal(
      'cancelAnimationFrame',
      vi.fn((frame: number) => animationFrames.delete(frame)),
    );
    vi.mocked(streamTurnContent)
      .mockReturnValueOnce(
        (async function* () {
          yield { content: [{ type: 'text' as const, text: 'first reply' }] };
          await new Promise<void>(resolve => {
            releaseFirstStream = resolve;
          });
        })(),
      )
      .mockReturnValueOnce(
        (async function* () {
          yield { content: [{ type: 'text' as const, text: 'second reply' }] };
          await new Promise<void>(resolve => {
            releaseSecondStream = resolve;
          });
        })(),
      );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const firstSend = result.current.sendTurn({ userMessage: 'first' });
    await waitFor(() => expect(streamTurnContent).toHaveBeenCalledTimes(1));

    const secondSend = result.current.sendTurn({ userMessage: 'second' });
    await waitFor(() => expect(streamTurnContent).toHaveBeenCalledTimes(2));

    await act(async () => {
      releaseFirstStream?.();
      await firstSend;
    });

    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      animationFrames.get(2)?.(performance.now());
    });
    expect(result.current.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'second reply' }],
    });
    expect(result.current.messages.at(-1)?.status).not.toMatchObject({
      type: 'complete',
    });

    await act(async () => {
      releaseSecondStream?.();
      await secondSend;
    });
  });

  it('aborts the prior client stream on a new user send without cancelSession', async () => {
    let firstSignal: AbortSignal | undefined;
    let releaseFirstStream: (() => void) | undefined;
    let releaseSecondStream: (() => void) | undefined;
    const runningValues: boolean[] = [];

    vi.mocked(streamTurnContent)
      .mockImplementationOnce(async function* (_server, _sessionId, _fold, _options, signal) {
        firstSignal = signal;
        yield { content: [{ type: 'text' as const, text: 'first reply' }] };
        await new Promise<void>(resolve => {
          releaseFirstStream = resolve;
        });
      })
      .mockImplementationOnce(async function* () {
        yield { content: [{ type: 'text' as const, text: 'second reply' }] };
        await new Promise<void>(resolve => {
          releaseSecondStream = resolve;
        });
      });

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const firstSend = result.current.sendTurn({ userMessage: 'first' });
    await waitFor(() => expect(streamTurnContent).toHaveBeenCalledTimes(1));
    expect(result.current.isRunning).toBe(true);
    runningValues.push(result.current.isRunning);

    const secondSend = result.current.sendTurn({ userMessage: 'second' });
    await waitFor(() => expect(streamTurnContent).toHaveBeenCalledTimes(2));
    runningValues.push(result.current.isRunning);

    expect(firstSignal?.aborted).toBe(true);
    expect(mockServer.cancelSession).not.toHaveBeenCalled();
    expect(runningValues.every(value => value)).toBe(true);

    await act(async () => {
      releaseFirstStream?.();
      await firstSend.catch(() => undefined);
    });
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      releaseSecondStream?.();
      await secondSend;
    });
  });

  it('keeps mid-stream user and assistant content when a later user message supersedes', async () => {
    let releaseFirstStream: (() => void) | undefined;
    let releaseSecondStream: (() => void) | undefined;
    const runningValues: boolean[] = [];

    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callback(performance.now());
        return 1;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());

    vi.mocked(streamTurnContent)
      .mockImplementationOnce(async function* () {
        yield { content: [{ type: 'text' as const, text: 'first partial' }] };
        await new Promise<void>(resolve => {
          releaseFirstStream = resolve;
        });
      })
      .mockImplementationOnce(async function* () {
        yield { content: [{ type: 'text' as const, text: 'second reply' }] };
        await new Promise<void>(resolve => {
          releaseSecondStream = resolve;
        });
      });

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const firstSend = result.current.sendTurn({ userMessage: 'first' });
    await waitFor(() =>
      expect(
        result.current.messages.some(
          message =>
            message.role === 'assistant' &&
            message.content.some(part => part.type === 'text' && part.text === 'first partial'),
        ),
      ).toBe(true),
    );
    runningValues.push(result.current.isRunning);

    const secondSend = result.current.sendTurn({ userMessage: 'second' });
    await waitFor(() => expect(streamTurnContent).toHaveBeenCalledTimes(2));
    runningValues.push(result.current.isRunning);

    expect(mockServer.cancelSession).not.toHaveBeenCalled();
    expect(runningValues.every(value => value)).toBe(true);

    const userTexts = result.current.messages
      .filter(message => message.role === 'user')
      .map(message =>
        message.content
          .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
          .map(part => part.text)
          .join(''),
      );
    expect(userTexts).toEqual(['first', 'second']);

    const cancelledAssistant = result.current.messages.find(
      message =>
        message.role === 'assistant' &&
        message.content.some(part => part.type === 'text' && part.text === 'first partial'),
    );
    expect(cancelledAssistant).toMatchObject({
      role: 'assistant',
      status: { type: 'incomplete', reason: 'cancelled' },
    });

    await act(async () => {
      releaseFirstStream?.();
      await firstSend.catch(() => undefined);
    });
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      releaseSecondStream?.();
      await secondSend;
    });
  });

  it('keeps the first user message when a later send arrives before any assistant token', async () => {
    let releaseFirstStream: (() => void) | undefined;
    let releaseSecondStream: (() => void) | undefined;

    vi.mocked(streamTurnContent)
      .mockImplementationOnce(async function* () {
        await new Promise<void>(resolve => {
          releaseFirstStream = resolve;
        });
        yield { content: [{ type: 'text' as const, text: 'late first reply' }] };
      })
      .mockImplementationOnce(async function* () {
        yield { content: [{ type: 'text' as const, text: 'second reply' }] };
        await new Promise<void>(resolve => {
          releaseSecondStream = resolve;
        });
      });

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const firstSend = result.current.sendTurn({ userMessage: 'first before tokens' });
    await waitFor(() => expect(streamTurnContent).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        result.current.messages.some(
          message =>
            message.role === 'user' &&
            message.content.some(part => part.type === 'text' && part.text === 'first before tokens'),
        ),
      ).toBe(true),
    );

    const secondSend = result.current.sendTurn({ userMessage: 'second' });
    await waitFor(() => expect(streamTurnContent).toHaveBeenCalledTimes(2));

    expect(mockServer.cancelSession).not.toHaveBeenCalled();
    const userTexts = result.current.messages
      .filter(message => message.role === 'user')
      .map(message =>
        message.content
          .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
          .map(part => part.text)
          .join(''),
      );
    expect(userTexts).toEqual(['first before tokens', 'second']);
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      releaseFirstStream?.();
      await firstSend.catch(() => undefined);
    });
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      releaseSecondStream?.();
      await secondSend;
    });
  });

  it('does not let a slower earlier send overwrite a later turn', async () => {
    let releaseFirstHeaders: (() => void) | undefined;
    const getTurnHeaders = vi.fn();
    getTurnHeaders.mockImplementationOnce(
      () =>
        new Promise<Record<string, string> | undefined>(resolve => {
          releaseFirstHeaders = () => resolve(undefined);
        }),
    );
    getTurnHeaders.mockResolvedValue(undefined);

    let releaseSecondStream: (() => void) | undefined;
    vi.mocked(streamTurnContent).mockImplementation(async function* () {
      yield { content: [{ type: 'text' as const, text: 'second reply' }] };
      await new Promise<void>(resolve => {
        releaseSecondStream = resolve;
      });
    });

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        getTurnHeaders,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let firstSend: Promise<void> | undefined;
    await act(async () => {
      firstSend = result.current.sendTurn({ userMessage: 'first' });
    });
    await waitFor(() => expect(getTurnHeaders).toHaveBeenCalledTimes(1));
    expect(streamTurnContent).not.toHaveBeenCalled();

    let secondSend: Promise<void> | undefined;
    await act(async () => {
      secondSend = result.current.sendTurn({ userMessage: 'second' });
    });
    await waitFor(() => expect(streamTurnContent).toHaveBeenCalledTimes(1));

    await act(async () => {
      releaseFirstHeaders?.();
      await firstSend;
    });

    expect(streamTurnContent).toHaveBeenCalledTimes(1);
    const userTexts = result.current.messages
      .filter(message => message.role === 'user')
      .map(message =>
        message.content
          .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
          .map(part => part.text)
          .join(''),
      );
    expect(userTexts).toEqual(['second']);

    await act(async () => {
      releaseSecondStream?.();
      await secondSend;
    });
  });

  it('drops ask-user pause chrome after a superseding user send', async () => {
    vi.mocked(loadSessionSnapshot).mockResolvedValue(snapshotWithAskUserPendingInFold());
    vi.mocked(streamTurnContent).mockReturnValue(
      (async function* () {
        yield { content: [{ type: 'text' as const, text: 'new reply' }] };
      })(),
    );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(collectPendingToolResponses(result.current.messages)).toHaveLength(1));

    await act(async () => {
      await result.current.sendTurn({ userMessage: 'ignore the question' });
    });

    expect(collectPendingToolResponses(result.current.messages)).toHaveLength(0);
    expect(mockServer.cancelSession).not.toHaveBeenCalled();
    const paused = result.current.messages.find(message => message.role === 'assistant' && message.id.includes('ask'));
    if (paused?.role === 'assistant') {
      expect(paused.status.type).not.toBe('requires-action');
    }
  });

  it('carries a streamed sandboxId through commit so it survives after the stream completes', async () => {
    vi.mocked(streamTurnContent).mockReturnValue(
      (async function* () {
        yield {
          content: [{ type: 'text' as const, text: 'streamed reply' }],
          metadata: { custom: { sandboxId: 'sbx-123' } },
        };
      })(),
    );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.sendTurn({ userMessage: 'hello there' });
    });

    expect(result.current.messages[1]).toMatchObject({
      role: 'assistant',
      metadata: { custom: { sandboxId: 'sbx-123' } },
    });
  });

  it('sendTurn with approvals streams a continuation without adding a user message', async () => {
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      snapshotWithAssistantMessage(assistantMessageWithPendingApproval()),
    );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await act(async () => {
      await result.current.sendTurn({
        inputs: [
          {
            type: 'user.tool_approval',
            threadId: ROOT_THREAD_ID,
            toolCallId: 'approval-1',
            approval: { status: 'allow' },
          },
        ],
      });
    });

    expect(streamTurnContent).toHaveBeenCalledWith(
      mockServer,
      'session-1',
      expect.any(PeerThreadFoldState),
      {
        inputs: [
          {
            type: 'user.tool_approval',
            threadId: ROOT_THREAD_ID,
            toolCallId: 'approval-1',
            approval: { status: 'allow' },
          },
        ],
      },
      expect.any(AbortSignal),
      expect.any(Array),
      expect.any(Function),
      expect.any(Function),
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.messages[0]?.role).toBe('assistant');
  });

  it('commits a continuation under the gateway turn id when no active stream exists', async () => {
    // Reproduces the "Turn not found: <7-char id>" failure: the paused
    // stream was already committed (activeStream cleared), so the resume
    // turn used to run under a local generateId() that leaked into
    // custom.turnId and the committed record.
    const fold = new PeerThreadFoldState();
    ingestTurnEvent(fold, {
      type: 'model.message',
      id: 'model-1',
      createdAt: new Date().toISOString(),
      threadId: ROOT_THREAD_ID,
      content: 'committed reply',
    });
    const createdAt = new Date().toISOString();
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      replaceSessionSnapshot(createEmptySessionSnapshot(), {
        fold,
        turns: [
          {
            id: 'turn-1',
            userText: 'hi',
            createdAt,
            state: {
              status: 'done',
              requiredActions: [],
              completedAt: createdAt,
            },
            input: [{ type: 'user.message', content: 'hi' }],
            rootModelMessageIds: ['model-1'],
          },
        ],
      }),
    );
    vi.mocked(streamTurnContent).mockImplementation(
      (_server, _sessionId, _fold, _options, _signal, _baseline, onTurnIdAvailable) =>
        (async function* () {
          onTurnIdAvailable?.('gw-turn-2');
          yield {
            content: [{ type: 'text' as const, text: 'resumed' }],
          };
        })(),
    );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));

    await act(async () => {
      await result.current.sendTurn({
        inputs: [
          {
            type: 'user.tool_approval',
            threadId: ROOT_THREAD_ID,
            toolCallId: 'approval-1',
            approval: { status: 'allow' },
          },
        ],
      });
    });

    const assistant = result.current.messages[1];
    expect(assistant?.role).toBe('assistant');
    expect(assistant?.metadata.custom).toMatchObject({ turnId: 'gw-turn-2' });
  });

  it('resolveSandboxIdForTurn returns the sandbox current as of that turn', async () => {
    const createdAt = new Date().toISOString();
    const doneState = {
      status: 'done' as const,
      requiredActions: [],
      completedAt: createdAt,
    };
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      replaceSessionSnapshot(createEmptySessionSnapshot(), {
        turns: [
          { id: 'turn-1', createdAt, state: doneState, sandboxId: 'sbx-1' },
          { id: 'turn-2', createdAt, state: doneState },
          { id: 'turn-3', createdAt, state: doneState, sandboxId: 'sbx-2' },
        ],
      }),
    );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // turn-2's artifacts came from the sandbox created at turn-1, not the
    // session-wide latest (turn-3's).
    await expect(result.current.resolveSandboxIdForTurn('turn-2')).resolves.toBe('sbx-1');
    await expect(result.current.resolveSandboxIdForTurn('turn-3')).resolves.toBe('sbx-2');
    // Unknown turn falls back to the latest sandbox in the loaded window.
    await expect(result.current.resolveSandboxIdForTurn('turn-unknown')).resolves.toBe('sbx-2');
  });

  it('resolveSandboxIdForTurn pages in older history when the sandbox reference is not loaded', async () => {
    const createdAt = new Date().toISOString();
    const doneState = {
      status: 'done' as const,
      requiredActions: [],
      completedAt: createdAt,
    };
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      replaceSessionSnapshot(createEmptySessionSnapshot(), {
        turns: [{ id: 'turn-9', createdAt, state: doneState }],
        historyPagination: { hasOlder: true, olderPageToken: 'tok-1' },
      }),
    );
    vi.mocked(prependOlderSessionHistory).mockResolvedValueOnce(
      replaceSessionSnapshot(createEmptySessionSnapshot(), {
        turns: [
          { id: 'turn-1', createdAt, state: doneState, sandboxId: 'sbx-old' },
          { id: 'turn-9', createdAt, state: doneState },
        ],
        historyPagination: { hasOlder: false },
      }),
    );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let resolved: string | undefined;
    await act(async () => {
      resolved = await result.current.resolveSandboxIdForTurn('turn-9');
    });

    expect(resolved).toBe('sbx-old');
    expect(prependOlderSessionHistory).toHaveBeenCalledTimes(1);
  });

  it('does not merge session A older history onto session B after a switch', async () => {
    // Bugbot: a stale resolveSandboxIdForTurn / loadOlderHistory closed over
    // session A can run after switch, capture B's loadGeneration, and commit
    // A's pages onto B's snapshot — or return B's sandboxId for A's turn.
    const createdAt = new Date().toISOString();
    const doneState = {
      status: 'done' as const,
      requiredActions: [],
      completedAt: createdAt,
    };

    vi.mocked(loadSessionSnapshot)
      .mockResolvedValueOnce(
        replaceSessionSnapshot(createEmptySessionSnapshot(), {
          turns: [{ id: 'turn-a', createdAt, state: doneState }],
          historyPagination: { hasOlder: true, olderPageToken: 'tok-a' },
        }),
      )
      .mockResolvedValueOnce(
        replaceSessionSnapshot(createEmptySessionSnapshot(), {
          turns: [
            {
              id: 'turn-b',
              createdAt,
              state: doneState,
              sandboxId: 'sbx-b',
            },
          ],
          historyPagination: { hasOlder: false },
        }),
      );

    vi.mocked(prependOlderSessionHistory).mockImplementation(async (_server, _sessionId, snapshot) =>
      replaceSessionSnapshot(snapshot, {
        turns: [
          {
            id: 'turn-old-a',
            createdAt,
            state: doneState,
            sandboxId: 'sbx-a-pollute',
          },
          ...snapshot.turns,
        ],
        historyPagination: { hasOlder: false },
      }),
    );

    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: string }) => useTrueForgeAgentMessages({ server: mockServer, sessionId }),
      { initialProps: { sessionId: 'session-a' } },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // Capture the session-A closures, then switch so later calls are stale.
    const resolveFromA = result.current.resolveSandboxIdForTurn;
    const loadOlderFromA = result.current.loadOlderHistory;

    rerender({ sessionId: 'session-b' });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(result.current.resolveSandboxIdForTurn).not.toBe(resolveFromA));

    let staleResolved: string | undefined = 'sentinel';
    await act(async () => {
      staleResolved = await resolveFromA('turn-a');
      await loadOlderFromA();
    });

    // Stale resolve must not read B's sandbox; stale load must not commit.
    expect(staleResolved).toBeUndefined();
    expect(prependOlderSessionHistory).not.toHaveBeenCalled();
    await expect(result.current.resolveSandboxIdForTurn('turn-b')).resolves.toBe('sbx-b');
    expect(
      result.current.messages.some(
        message => (message.metadata.custom as { turnId?: string } | undefined)?.turnId === 'turn-old-a',
      ),
    ).toBe(false);
  });

  it('respondToToolApproval records approval decisions on the pending tool call', async () => {
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      snapshotWithAssistantMessage(assistantMessageWithPendingApproval()),
    );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await act(async () => {
      result.current.respondToToolApproval({
        approvalId: 'approval-1',
        approved: true,
      });
    });

    await waitFor(() => {
      const assistant = result.current.messages[0];
      expect(assistant?.role).toBe('assistant');
      if (assistant?.role !== 'assistant') {
        return;
      }
      expect(messageHasPendingApprovals(assistant)).toBe(false);
      const toolCall = assistant.content[0];
      if (toolCall?.type !== 'tool-call') {
        return;
      }
      expect(toolCall.approval?.approved).toBe(true);
    });

    expect(streamTurnContent).toHaveBeenCalled();
  });

  it('respondToToolApproval sends combined inputs only after responses are answered', async () => {
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      snapshotWithAssistantMessage(assistantMessageWithPendingApprovalAndResponse()),
    );

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.messages).toHaveLength(1));

    await act(async () => {
      result.current.respondToToolApproval({
        approvalId: 'approval-1',
        approved: true,
      });
    });

    expect(streamTurnContent).not.toHaveBeenCalled();

    await act(async () => {
      result.current.respondToToolResponse({
        toolCallId: 'question-1',
        content: 'A',
      });
    });

    await waitFor(() => expect(streamTurnContent).toHaveBeenCalled());
    expect(streamTurnContent).toHaveBeenCalledWith(
      mockServer,
      'session-1',
      expect.any(PeerThreadFoldState),
      {
        inputs: [
          {
            type: 'user.tool_approval',
            threadId: ROOT_THREAD_ID,
            toolCallId: 'approval-1',
            approval: { status: 'allow' },
          },
          {
            type: 'user.tool_response',
            threadId: ROOT_THREAD_ID,
            toolCallId: 'question-1',
            content: 'A',
          },
        ],
      },
      expect.any(AbortSignal),
      expect.any(Array),
      expect.any(Function),
      expect.any(Function),
    );

    const assistant = result.current.messages[0];
    expect(assistant?.role).toBe('assistant');
    if (assistant?.role !== 'assistant') {
      return;
    }
    expect(messageHasPendingApprovals(assistant)).toBe(false);
    expect(messageHasPendingResponses(assistant)).toBe(false);
  });

  it('keeps ask-user resolved after respond and stream completion clears overlay', async () => {
    vi.mocked(loadSessionSnapshot).mockResolvedValue(snapshotWithAskUserPendingInFold());

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.messages).toHaveLength(2));
    expect(collectPendingToolResponses(result.current.messages)).toHaveLength(1);

    await act(async () => {
      result.current.respondToToolResponse({
        toolCallId: 'question-1',
        content: 'A',
      });
    });

    await waitFor(() => expect(streamTurnContent).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isRunning).toBe(false));

    expect(collectPendingToolResponses(result.current.messages)).toHaveLength(0);
    const assistant = result.current.messages.find(m => m.role === 'assistant');
    expect(assistant).toBeDefined();
    expect(messageHasPendingResponses(assistant)).toBe(false);
  });

  describe('batched resume invariant', () => {
    it('issues exactly one createTurn input batch across root and sub-agent threads', async () => {
      vi.mocked(loadSessionSnapshot).mockResolvedValue(
        snapshotWithAssistantMessage(assistantMessageWithMultiThreadPendingActions()),
      );

      const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
      await waitFor(() => expect(result.current.messages).toHaveLength(1));

      await act(async () => {
        result.current.respondToToolResponse({
          toolCallId: 'question-sub',
          content: 'sub-answer',
        });
      });
      expect(streamTurnContent).not.toHaveBeenCalled();

      await act(async () => {
        result.current.respondToToolApproval({
          approvalId: 'approval-root',
          approved: true,
        });
      });

      await waitFor(() => expect(streamTurnContent).toHaveBeenCalledTimes(1));
      expect(streamTurnContent).toHaveBeenCalledWith(
        mockServer,
        'session-1',
        expect.any(PeerThreadFoldState),
        {
          inputs: [
            {
              type: 'user.tool_approval',
              threadId: ROOT_THREAD_ID,
              toolCallId: 'approval-root',
              approval: { status: 'allow' },
            },
            {
              type: 'user.tool_response',
              threadId: 'child-1',
              toolCallId: 'question-sub',
              content: 'sub-answer',
            },
          ],
        },
        expect.any(AbortSignal),
        expect.any(Array),
        expect.any(Function),
        expect.any(Function),
      );
    });

    it('does not resume after the first resolved action when another is still pending', async () => {
      vi.mocked(loadSessionSnapshot).mockResolvedValue(
        snapshotWithAssistantMessage(assistantMessageWithPendingApprovalAndResponse()),
      );

      const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
      await waitFor(() => expect(result.current.messages).toHaveLength(1));

      await act(async () => {
        result.current.respondToToolResponse({
          toolCallId: 'question-1',
          content: 'A',
        });
      });

      expect(streamTurnContent).not.toHaveBeenCalled();
      expect(messageHasPendingApprovals(result.current.messages[0]!)).toBe(true);
      expect(messageHasPendingResponses(result.current.messages[0]!)).toBe(false);
    });
  });

  it('cancel drains the stream gracefully and calls cancelSession', async () => {
    let resolveStream: (() => void) | undefined;
    vi.mocked(streamTurnContent).mockReturnValue(
      (async function* () {
        yield { content: [{ type: 'text' as const, text: 'partial' }] };
        await new Promise<void>(resolve => {
          resolveStream = resolve;
        });
      })(),
    );
    // cancelSession makes the backend close the SSE stream gracefully,
    // which ends the active iterator on its own.
    vi.mocked(mockServer.cancelSession).mockImplementation(async () => {
      resolveStream?.();
    });

    const { result } = renderHook(() => useTrueForgeAgentMessages({ server: mockServer, sessionId: 'session-1' }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.sendTurn({ userMessage: 'hello' });
    });
    await waitFor(() => expect(result.current.isRunning).toBe(true));

    await act(async () => {
      await result.current.cancel();
      await sendPromise;
    });

    expect(mockServer.cancelSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expect(result.current.isRunning).toBe(false);
    // No reconcile is triggered by cancel; the session was only loaded once
    // on mount and reconciles against the event log on the next page load.
    expect(loadSessionSnapshot).toHaveBeenCalledTimes(1);
  });

  it('clears isRunning when a supersede send fails before runStream starts', async () => {
    let resolveFirstStream: (() => void) | undefined;
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn((callback: FrameRequestCallback) => {
        callback(performance.now());
        return 1;
      }),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.mocked(streamTurnContent).mockReturnValue(
      (async function* () {
        yield { content: [{ type: 'text' as const, text: 'partial' }] };
        await new Promise<void>(resolve => {
          resolveFirstStream = resolve;
        });
      })(),
    );

    const getTurnHeaders = vi.fn();
    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        getTurnHeaders,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // First turn starts running
    let firstTurnPromise: Promise<void> | undefined;
    await act(async () => {
      firstTurnPromise = result.current.sendTurn({ userMessage: 'turn 1' });
    });
    await waitFor(() =>
      expect(
        result.current.messages.some(
          message =>
            message.role === 'assistant' &&
            message.content.some(part => part.type === 'text' && part.text === 'partial'),
        ),
      ).toBe(true),
    );

    // A second send supersedes the first one, but getTurnHeaders rejects
    getTurnHeaders.mockRejectedValue(new Error('Auth token expired'));

    await act(async () => {
      await expect(result.current.sendTurn({ userMessage: 'turn 2' })).rejects.toThrow('Auth token expired');
    });

    // The first stream was aborted by the supersede, and wait for it to complete
    resolveFirstStream?.();
    await act(async () => {
      await firstTurnPromise?.catch(() => undefined);
    });

    expect(result.current.isRunning).toBe(false);
    const userTexts = result.current.messages
      .filter(message => message.role === 'user')
      .map(message =>
        message.content
          .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
          .map(part => part.text)
          .join(''),
      );
    expect(userTexts).toEqual(['turn 1']);
    expect(result.current.messages.find(message => message.role === 'assistant')).toMatchObject({
      role: 'assistant',
      status: { type: 'incomplete', reason: 'cancelled' },
    });
  });

  it('cancel clears isRunning even after a failed supersede', async () => {
    let resolveFirstStream: (() => void) | undefined;
    vi.mocked(streamTurnContent).mockReturnValue(
      (async function* () {
        yield { content: [{ type: 'text' as const, text: 'partial' }] };
        await new Promise<void>(resolve => {
          resolveFirstStream = resolve;
        });
      })(),
    );

    const getTurnHeaders = vi.fn();
    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        getTurnHeaders,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // First turn starts running
    let firstTurnPromise: Promise<void> | undefined;
    await act(async () => {
      firstTurnPromise = result.current.sendTurn({ userMessage: 'turn 1' });
    });
    await waitFor(() => expect(result.current.isRunning).toBe(true));

    // Second turn supersedes and fails
    getTurnHeaders.mockRejectedValue(new Error('Failed header resolution'));
    await act(async () => {
      await expect(result.current.sendTurn({ userMessage: 'turn 2' })).rejects.toThrow('Failed header resolution');
    });

    // User triggers cancel
    vi.mocked(mockServer.cancelSession).mockImplementation(async () => {
      resolveFirstStream?.();
    });

    await act(async () => {
      await result.current.cancel();
      await firstTurnPromise?.catch(() => undefined);
    });

    expect(result.current.isRunning).toBe(false);
  });

  describe('pre-turn failure rollback', () => {
    it('reports and restores a user message when initializeSession fails', async () => {
      const onError = vi.fn();
      const onPreTurnFailure = vi.fn();
      const initializeSession = vi.fn().mockRejectedValue(new Error('Draft session creation failed'));

      const { result } = renderHook(() =>
        useTrueForgeAgentMessages({
          server: mockServer,
          sessionId: undefined,
          initializeSession,
          onError,
        }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.messages).toEqual([]);

      await act(async () => {
        await expect(
          result.current.sendTurn({
            userMessage: 'test message',
            onPreTurnFailure,
          }),
        ).rejects.toThrow('Draft session creation failed');
      });

      expect(result.current.messages).toEqual([]);
      expect(onPreTurnFailure).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
      expect(initializeSession).toHaveBeenCalledOnce();
      expect(streamTurnContent).not.toHaveBeenCalled();
    });

    it('rolls back when the turns stream fails before turn.created', async () => {
      const onError = vi.fn();
      const onPreTurnFailure = vi.fn();
      vi.mocked(streamTurnContent).mockImplementation(async function* () {
        throw new Error('Turn preparation failed');
      });

      const { result } = renderHook(() =>
        useTrueForgeAgentMessages({
          server: mockServer,
          sessionId: 'session-1',
          onError,
        }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await expect(
          result.current.sendTurn({
            userMessage: 'test message',
            onPreTurnFailure,
          }),
        ).rejects.toThrow('Turn preparation failed');
      });

      expect(result.current.messages).toEqual([]);
      expect(onPreTurnFailure).toHaveBeenCalledOnce();
      expect(onError).toHaveBeenCalledWith(expect.any(Error));
    });

    it('does not roll back after turn.created registers the user message', async () => {
      const onError = vi.fn();
      const onPreTurnFailure = vi.fn();
      vi.mocked(streamTurnContent).mockImplementation(
        async function* (_server, _sessionId, _fold, _options, _signal, _baseline, onTurnIdAvailable) {
          onTurnIdAvailable?.('gateway-turn-123');
          yield { content: [{ type: 'text' as const, text: 'partial' }], sequenceNumber: 4 };
          throw new Error('Mid-stream error');
        },
      );

      const { result } = renderHook(() =>
        useTrueForgeAgentMessages({
          server: mockServer,
          sessionId: 'session-1',
          onError,
        }),
      );

      await waitFor(() => expect(result.current.isLoading).toBe(false));

      await act(async () => {
        await result.current.sendTurn({
          userMessage: 'test message',
          onPreTurnFailure,
        });
      });

      const userMessages = result.current.messages.filter(m => m.role === 'user');
      expect(userMessages).toHaveLength(1);
      expect(userMessages[0]?.content[0]).toMatchObject({
        type: 'text',
        text: 'test message',
      });
      expect(onPreTurnFailure).not.toHaveBeenCalled();
      expect(onError).not.toHaveBeenCalled();
      expect(resumeTurnStream).toHaveBeenCalledWith(
        mockServer,
        'session-1',
        'gateway-turn-123',
        expect.anything(),
        expect.any(AbortSignal),
        4,
        expect.anything(),
        expect.any(Function),
      );
    });
  });

  it('does not subscribe-retry when the create stream fails before turn.created', async () => {
    const onError = vi.fn();
    vi.mocked(streamTurnContent).mockImplementation(async function* () {
      throw new Error('network error');
    });

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        onError,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.sendTurn({ userMessage: 'hello' })).rejects.toThrow('network error');
    });

    expect(resumeTurnStream).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(result.current.isRunning).toBe(false);
  });

  it('keeps isRunning until subscribe retry finishes after a live SSE drop', async () => {
    const onError = vi.fn();
    let releaseSubscribe: (() => void) | undefined;
    vi.mocked(streamTurnContent).mockImplementation(
      async function* (_server, _sessionId, _fold, _options, _signal, _baseline, onTurnIdAvailable) {
        onTurnIdAvailable?.('gateway-turn-live');
        yield { content: [{ type: 'text' as const, text: 'partial' }], sequenceNumber: 2 };
        throw new Error('network error');
      },
    );
    vi.mocked(resumeTurnStream).mockReturnValue(
      (async function* () {
        await new Promise<void>(resolve => {
          releaseSubscribe = resolve;
        });
        yield { content: [{ type: 'text' as const, text: 'resumed' }], sequenceNumber: 3 };
      })(),
    );

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        onError,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.sendTurn({ userMessage: 'hello' });
    });

    await waitFor(() => expect(resumeTurnStream).toHaveBeenCalled());
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.isRunning).toBe(true);

    await act(async () => {
      releaseSubscribe?.();
      await sendPromise;
    });

    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not subscribe when cancel aborts a reconnect delay', async () => {
    const onError = vi.fn();
    let delayStarted: (() => void) | undefined;
    const delayReady = new Promise<void>(resolve => {
      delayStarted = resolve;
    });
    vi.mocked(delayReconnect).mockImplementation(async (signal: AbortSignal) => {
      delayStarted?.();
      await new Promise<void>((_resolve, reject) => {
        const fail = (): void => {
          const error = new Error('Aborted');
          error.name = 'AbortError';
          reject(error);
        };
        if (signal.aborted) {
          fail();
          return;
        }
        signal.addEventListener('abort', fail, { once: true });
      });
    });
    vi.mocked(streamTurnContent).mockImplementation(
      async function* (_server, _sessionId, _fold, _options, _signal, _baseline, onTurnIdAvailable) {
        onTurnIdAvailable?.('gateway-turn-cancel-reconnect');
        yield { content: [{ type: 'text' as const, text: 'partial' }], sequenceNumber: 1 };
        throw new Error('network error');
      },
    );

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        onError,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.sendTurn({ userMessage: 'hello' });
    });
    await delayReady;

    await act(async () => {
      await result.current.cancel();
      await sendPromise;
    });

    expect(resumeTurnStream).not.toHaveBeenCalled();
    expect(mockServer.cancelSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expect(result.current.isRunning).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not subscribe-retry when a cancelled live stream drops without turn.done', async () => {
    const onError = vi.fn();
    let dropStream: (() => void) | undefined;
    vi.mocked(streamTurnContent).mockImplementation(
      async function* (_server, _sessionId, _fold, _options, _signal, _baseline, onTurnIdAvailable) {
        onTurnIdAvailable?.('gateway-turn-cancel-drop');
        yield { content: [{ type: 'text' as const, text: 'partial' }], sequenceNumber: 1 };
        await new Promise<void>((_resolve, reject) => {
          dropStream = () => {
            reject(new TurnStreamDisconnectedError());
          };
        });
      },
    );
    vi.mocked(mockServer.cancelSession).mockImplementation(async () => {
      dropStream?.();
    });

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        onError,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let sendPromise: Promise<void> | undefined;
    await act(async () => {
      sendPromise = result.current.sendTurn({ userMessage: 'hello' });
    });
    await waitFor(() => expect(result.current.isRunning).toBe(true));

    await act(async () => {
      await result.current.cancel();
      await sendPromise;
    });

    expect(resumeTurnStream).not.toHaveBeenCalled();
    expect(mockServer.cancelSession).toHaveBeenCalledWith({ sessionId: 'session-1' });
    expect(result.current.isRunning).toBe(false);
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not subscribe-retry when the in-flight stream is aborted', async () => {
    const onError = vi.fn();
    let releaseFirst: (() => void) | undefined;
    let streamTurnCalls = 0;
    vi.mocked(streamTurnContent).mockImplementation(
      async function* (_server, _sessionId, _fold, _options, _signal, _baseline, onTurnIdAvailable) {
        streamTurnCalls += 1;
        if (streamTurnCalls === 1) {
          onTurnIdAvailable?.('gateway-turn-abort');
          yield { content: [{ type: 'text' as const, text: 'partial' }], sequenceNumber: 1 };
          await new Promise<void>(resolve => {
            releaseFirst = resolve;
          });
          return;
        }
        onTurnIdAvailable?.('gateway-turn-two');
        yield { content: [{ type: 'text' as const, text: 'second' }], sequenceNumber: 1 };
      },
    );

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        onError,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let firstSend: Promise<void> | undefined;
    await act(async () => {
      firstSend = result.current.sendTurn({ userMessage: 'one' });
    });
    await waitFor(() => expect(result.current.isRunning).toBe(true));
    vi.mocked(resumeTurnStream).mockClear();

    await act(async () => {
      await result.current.sendTurn({ userMessage: 'two' });
    });
    await act(async () => {
      releaseFirst?.();
      await firstSend?.catch(() => undefined);
    });

    expect(resumeTurnStream).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it('does not subscribe-retry a terminal turn.done error', async () => {
    const onError = vi.fn();
    vi.mocked(streamTurnContent).mockImplementation(
      async function* (_server, _sessionId, _fold, _options, _signal, _baseline, onTurnIdAvailable) {
        onTurnIdAvailable?.('gateway-turn-failed');
        yield { content: [{ type: 'text' as const, text: 'partial' }], sequenceNumber: 1 };
        throw new TurnFailedError('Publisher Model is not servable');
      },
    );

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        onError,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.sendTurn({ userMessage: 'hello' })).rejects.toThrow(
        'Publisher Model is not servable',
      );
    });

    expect(resumeTurnStream).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
  });

  it('reports onError after exhausting subscribe retries', async () => {
    const onError = vi.fn();
    vi.mocked(streamTurnContent).mockImplementation(
      async function* (_server, _sessionId, _fold, _options, _signal, _baseline, onTurnIdAvailable) {
        onTurnIdAvailable?.('gateway-turn-retry');
        yield { content: [{ type: 'text' as const, text: 'partial' }], sequenceNumber: 1 };
        throw new Error('network error');
      },
    );
    vi.mocked(resumeTurnStream).mockImplementation(async function* () {
      throw new Error('subscribe failed');
    });

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        onError,
      }),
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await expect(result.current.sendTurn({ userMessage: 'hello' })).rejects.toThrow('subscribe failed');
    });

    expect(resumeTurnStream).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledWith(expect.any(Error));
    expect(result.current.isRunning).toBe(false);
  });

  it('resubscribes after a loaded running-turn subscribe drop', async () => {
    const onError = vi.fn();
    const runningTurn = {
      id: 'turn-running',
      sessionId: 'session-1',
      input: [{ type: 'user.message' as const, content: 'continue' }],
      state: { status: 'running' as const },
      createdAt: new Date().toISOString(),
    };
    vi.mocked(loadSessionSnapshot).mockResolvedValue(
      replaceSessionSnapshot(createEmptySessionSnapshot(), {
        runningTurn,
        unstable_resume: true,
        pendingUser: {
          turnId: runningTurn.id,
          content: 'continue',
          createdAt: new Date(runningTurn.createdAt),
        },
      }),
    );
    let subscribeCalls = 0;
    vi.mocked(resumeTurnStream).mockImplementation(async function* (_server, _sid, _tid, _fold, _signal, afterSeq) {
      subscribeCalls += 1;
      if (subscribeCalls === 1) {
        yield { content: [{ type: 'text' as const, text: 'partial' }], sequenceNumber: 8 };
        throw new Error('network error');
      }
      expect(afterSeq).toBe(8);
      yield { content: [{ type: 'text' as const, text: 'resumed' }], sequenceNumber: 9 };
    });

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
        onError,
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    await waitFor(() => expect(subscribeCalls).toBe(2));
    await waitFor(() => expect(result.current.isRunning).toBe(false));
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.messages.at(-1)).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: 'resumed' }],
    });
  });

  it('does not produce duplicate assistant message IDs when turn ends on mcp.auth_required with zero model messages', async () => {
    const mcpServers = [
      {
        id: 'linear-mcp',
        name: 'linear-mcp',
        authUrl: 'https://internal.test/oauth',
      },
    ];

    vi.mocked(streamTurnContent).mockImplementation(
      async function* (_server, _sessionId, _fold, _options, _signal, _baseline, onTurnIdAvailable) {
        const turnId = 'gateway-turn-mcp-1';
        onTurnIdAvailable?.(turnId);
        yield {
          content: [
            { type: 'text' as const, text: 'This agent needs access to external services before it can continue.' },
          ],
          status: { type: 'requires-action' as const, reason: 'interrupt' as const },
          metadata: { custom: { pendingMcpAuth: true, mcpServers } },
        };
      },
    );

    const { result } = renderHook(() =>
      useTrueForgeAgentMessages({
        server: mockServer,
        sessionId: 'session-1',
      }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.sendTurn({ userMessage: 'hello' });
    });

    const assistantMessages = result.current.messages.filter(m => m.role === 'assistant');
    expect(assistantMessages).toHaveLength(1);
    expect(assistantMessages[0]?.id).toBe('gateway-turn-mcp-1-assistant');
    expect(assistantMessages[0]?.status).toEqual({ type: 'requires-action', reason: 'interrupt' });
    expect(assistantMessages[0]?.metadata.custom?.['pendingMcpAuth']).toBe(true);

    const ids = result.current.messages.map(m => m.id);
    const uniqueIds = new Set(ids);
    expect(ids.length).toBe(uniqueIds.size);
  });
});
