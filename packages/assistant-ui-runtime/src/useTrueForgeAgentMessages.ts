'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  McpAuthRequiredEvent,
  ToolApprovalRequiredEvent,
  ToolResponseRequiredEvent,
  Turn,
  TurnInputItem,
  TurnStateDone,
} from './server/index.js';
import type { AgentChatServer } from './server/types.js';

import { ROOT_THREAD_ID } from './constants.js';
import {
  buildEditedUserMessageContent,
  buildSnapshotThroughTurn,
  computeGroupRootBaseline,
  extractTurnUserMessageContent,
  prependOlderSessionHistory,
  projectSessionMessages,
  resolveGatewayBranchPreviousTurnIdForTurn,
  rootModelMessageIdsSinceBaseline,
  userMessageContentToText,
  type UserMessageContent,
} from './convertTurnMessages.js';
import { extractTurnUserText } from './extractTurnUserText.js';
import { loadSessionSnapshot } from './loadSessionSnapshot.js';
import { MCP_AUTH_RESUME_RUN_CUSTOM_KEY } from './mcpAuth.js';
import { isMcpServerAuthInfoList } from './messageCustomMetadata.js';
import {
  collectRequiredActionInputs,
  findPausedAssistantMessage,
  messageHasPendingRequiredActions,
  type RequiredActionInput,
} from './requiredActionInputs.js';
import {
  createEmptySessionSnapshot,
  replaceSessionSnapshot,
  type SessionSnapshot,
  type SessionTurnRecord,
} from './sessionSnapshot.js';
import { resumeTurnStream, streamTurnContent } from './streamTurn.js';
import { TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY, type RespondToToolApprovalOptions } from './toolApproval.js';
import {
  applyUserToolResponsesToFold,
  TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY,
  type RespondToToolResponseOptions,
} from './toolResponse.js';
import type { TurnStreamUpdate } from './turnStreamUpdate.js';

export interface UseTrueForgeAgentMessagesOptions {
  server: AgentChatServer;
  sessionId: string | undefined;
  /** When true the thread is the currently selected (main) thread. */
  isMain?: boolean | undefined;
  /** URL-selected session may load before the thread list marks it as main. */
  isInitialSession?: boolean | undefined;
  onError?: ((error: unknown) => void) | undefined;
  initializeSession?: () => Promise<{
    remoteId: string;
    externalId: string | undefined;
  }>;
  /** Maps a thread `remoteId` to the gateway session id used for turns. */
  resolveConversationSessionId?: (remoteId: string) => Promise<string>;
  /**
   * Optional per-turn headers for createTurn. Invoked once per `sendTurn` after
   * the session is resolved; return value is forwarded to `turn.execute`.
   */
  getTurnHeaders?: () => Promise<Record<string, string> | undefined>;
}

export type SendTurnOptions =
  | {
      userMessage: UserMessageContent;
      previousTurnId?: string | null;
      /** Invoked only when the user turn fails before the gateway registers it. */
      onPreTurnFailure?: () => void;
      /**
       * When branching (edit/reset), the already-rewound history to send from.
       * Applied atomically with `pendingUser` so a stale React snapshot cannot
       * keep pre-branch turns while the new user message is appended.
       */
      branchFromSnapshot?: SessionSnapshot;
      /** Original history restored when a branch fails before turn.created. */
      branchRollbackSnapshot?: SessionSnapshot;
    }
  | { inputs: RequiredActionInput[] }
  | { resumeMcpAuth: true };

function buildCompletedTurnState(
  completedAt: string,
  requiredActions: TurnStateDone['requiredActions'] = [],
): TurnStateDone {
  return {
    status: 'done',
    requiredActions,
    completedAt,
  };
}

/**
 * Reconstructs the pending required actions a paused in-flight update carried,
 * so the pause survives `commitActiveStream`'s synthetic "done" state.
 *
 * `commitActiveStream` fabricates a `TurnStateDone` for the just-finished
 * stream, and the projection derives an assistant message's `requires-action`
 * status from `turn.state.requiredActions` (see `findApprovalRequiredInTurn` /
 * `findResponseRequiredInTurn` / `findMcpAuthRequired`). If we returned an empty
 * list here, the committed turn would look "complete", the projected message
 * would lose its `requires-action` status, and `findPausedAssistantMessage`
 * (used by `trySendCollectedRequiredActions`) would never see it — so answering
 * a tool approval or an `ask_user_question` would never send the resume turn.
 *
 * The paused update already carries the pause state: `status` is
 * `requires-action` and `metadata.custom` holds the pending thread id(s) (and,
 * for MCP, the server list). Only the thread id is read downstream, so an empty
 * `toolCalls` list is sufficient here — the resume inputs are collected from the
 * message content, not from these reconstructed actions.
 */
export function requiredActionsFromActiveUpdate(update: TurnStreamUpdate): TurnStateDone['requiredActions'] {
  const custom = update.metadata?.custom;
  const requiredActions: TurnStateDone['requiredActions'] = [];
  const createdAt = new Date().toISOString();

  if (custom?.['pendingMcpAuth'] === true && isMcpServerAuthInfoList(custom['mcpServers'])) {
    const mcpAuthRequired: McpAuthRequiredEvent = {
      type: 'mcp.auth_required',
      id: crypto.randomUUID(),
      createdAt,
      mcpServers: custom['mcpServers'],
    };
    requiredActions.push(mcpAuthRequired);
  }

  if (update.status?.type === 'requires-action') {
    const approvalThreadId = custom?.[TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY];
    if (typeof approvalThreadId === 'string') {
      const approvalRequired: ToolApprovalRequiredEvent = {
        type: 'tool.approval_required',
        id: crypto.randomUUID(),
        createdAt,
        threadId: approvalThreadId,
        toolCalls: [],
      };
      requiredActions.push(approvalRequired);
    }

    const responseThreadId = custom?.[TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY];
    if (typeof responseThreadId === 'string') {
      const responseRequired: ToolResponseRequiredEvent = {
        type: 'tool.response_required',
        id: crypto.randomUUID(),
        createdAt,
        threadId: responseThreadId,
        toolCalls: [],
      };
      requiredActions.push(responseRequired);
    }
  }

  return requiredActions;
}

function buildUserTurnInput(content: UserMessageContent): TurnInputItem {
  return { type: 'user.message', content };
}

function appendTurnInputs(
  base: TurnInputItem[] | undefined,
  continuationInputs?: RequiredActionInput[],
): TurnInputItem[] {
  const existingInputs = base ?? [];
  if (continuationInputs == null || continuationInputs.length === 0) {
    return existingInputs;
  }
  return [...existingInputs, ...continuationInputs];
}

function cancelScheduledAnimationFrame(frame: number | null): void {
  if (frame != null) {
    cancelAnimationFrame(frame);
  }
}

function commitActiveStream(snapshot: SessionSnapshot, continuationInputs?: RequiredActionInput[]): SessionSnapshot {
  const active = snapshot.activeStream;
  if (active?.streamComplete !== true) {
    return snapshot;
  }

  const activeSandboxIdValue = active.update.metadata?.custom?.['sandboxId'];
  const activeSandboxId = typeof activeSandboxIdValue === 'string' ? activeSandboxIdValue : undefined;

  const completedState = buildCompletedTurnState(
    new Date().toISOString(),
    requiredActionsFromActiveUpdate(active.update),
  );
  const baseline = snapshot.groupRootBaseline ?? computeGroupRootBaseline(snapshot.turns);
  const rootModelMessageIds = rootModelMessageIdsSinceBaseline(snapshot.fold, baseline);

  const lastTurn = snapshot.turns.at(-1);
  if (lastTurn?.id === active.turnId) {
    return replaceSessionSnapshot(snapshot, {
      turns: snapshot.turns.map(turn =>
        turn.id === active.turnId
          ? {
              ...turn,
              state: completedState,
              input: appendTurnInputs(turn.input, continuationInputs),
              rootModelMessageIds,
              ...(activeSandboxId != null ? { sandboxId: activeSandboxId } : {}),
            }
          : turn,
      ),
      pendingUser: undefined,
      // Custom stream adapters may yield projected content without fold events.
      // Keep that completed projection until the next stream replaces it.
      ...(rootModelMessageIds.length > 0 ? { activeStream: undefined } : {}),
    });
  }

  const record: SessionTurnRecord = {
    id: active.turnId,
    createdAt: snapshot.pendingUser?.createdAt.toISOString() ?? new Date().toISOString(),
    state: completedState,
    input: appendTurnInputs(
      snapshot.pendingUser ? [buildUserTurnInput(snapshot.pendingUser.content)] : [],
      continuationInputs,
    ),
    ...(snapshot.pendingUser ? { userText: userMessageContentToText(snapshot.pendingUser.content) } : {}),
    rootModelMessageIds,
    ...(activeSandboxId != null ? { sandboxId: activeSandboxId } : {}),
  };

  return replaceSessionSnapshot(snapshot, {
    turns: [...snapshot.turns, record],
    pendingUser: undefined,
    ...(rootModelMessageIds.length > 0 ? { activeStream: undefined } : {}),
  });
}

/** Bounds the older-history page-ins a sandbox lookup may trigger. */
const MAX_SANDBOX_HISTORY_PAGE_INS = 20;

/**
 * sandboxId in effect as of `turnId`. An artifact can only come from a sandbox
 * created at or before its own turn, so scan records backward from that turn;
 * an unknown turn (e.g. projected only from the active stream) scans the whole
 * loaded window.
 */
function findSandboxIdInSnapshot(snapshot: SessionSnapshot, turnId: string): string | undefined {
  const active = snapshot.activeStream;
  if (active?.turnId === turnId) {
    const sandboxId = active.update.metadata?.custom?.['sandboxId'];
    if (typeof sandboxId === 'string') {
      return sandboxId;
    }
  }
  const turns = snapshot.turns;
  const turnIndex = turns.findIndex(turn => turn.id === turnId);
  for (let i = turnIndex === -1 ? turns.length - 1 : turnIndex; i >= 0; i--) {
    const sandboxId = turns[i]?.sandboxId;
    if (sandboxId != null) {
      return sandboxId;
    }
  }
  return undefined;
}

async function resolveActiveSessionId(
  remoteId: string,
  resolveConversationSessionId?: (remoteId: string) => Promise<string>,
): Promise<string> {
  if (resolveConversationSessionId != null) {
    return resolveConversationSessionId(remoteId);
  }
  return remoteId;
}

function resolveTurnInput(snapshot: SessionSnapshot, turnId: string): TurnInputItem[] | undefined {
  const turnRecord = snapshot.turns.find(turn => turn.id === turnId);
  if (turnRecord?.input != null) {
    return turnRecord.input;
  }
  if (snapshot.pendingUser?.turnId === turnId) {
    return [{ type: 'user.message', content: snapshot.pendingUser.content }];
  }
  return undefined;
}

export function useTrueForgeAgentMessages({
  server,
  sessionId,
  isMain,
  isInitialSession,
  onError,
  initializeSession,
  resolveConversationSessionId,
  getTurnHeaders,
}: UseTrueForgeAgentMessagesOptions) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>(createEmptySessionSnapshot);
  const [isRunning, setIsRunning] = useState(false);
  // Existing sessions have history pending from the first render. Starting at
  // false causes consumers to briefly render an empty thread before the load
  // effect runs and flips this flag to true.
  const [isLoading, setIsLoading] = useState(sessionId != null && (isMain !== false || isInitialSession === true));
  const [isLoadingOlderHistory, setIsLoadingOlderHistory] = useState(false);
  const [loadRetryTrigger, setLoadRetryTrigger] = useState(0);
  const [resumeUnavailable, setResumeUnavailable] = useState(false);

  const snapshotRef = useRef(snapshot);
  snapshotRef.current = snapshot;
  // Live session id — stale loadOlderHistory / resolveSandboxIdForTurn
  // closures compare against this so a post-switch iteration cannot merge
  // session A's pages onto session B's snapshot (generation alone is not
  // enough: a late call captures B's generation while still closed over A).
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const loadOlderInflightRef = useRef<Promise<void> | null>(null);

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const resolveConversationSessionIdRef = useRef(resolveConversationSessionId);
  resolveConversationSessionIdRef.current = resolveConversationSessionId;
  const initializeSessionRef = useRef(initializeSession);
  initializeSessionRef.current = initializeSession;
  const getTurnHeadersRef = useRef(getTurnHeaders);
  getTurnHeadersRef.current = getTurnHeaders;

  const createdAtByMessageIdRef = useRef(new Map<string, Date>());
  const abortControllerRef = useRef<AbortController | null>(null);
  const activeRunRef = useRef<Promise<void> | null>(null);
  // Mirrors `resumeUnavailable` for `cancel`, which reads it outside render.
  const resumeUnavailableRef = useRef(false);
  const runningTurnRef = useRef<Turn | undefined>(undefined);
  const loadGenerationRef = useRef(0);
  const streamGenerationRef = useRef(0);
  const lazilyCreatedSessionIdRef = useRef<string | undefined>(undefined);
  const initialLoadStartedForRef = useRef<string | undefined>(undefined);
  const skipInitialPromotionLoadForRef = useRef<string | undefined>(undefined);

  /**
   * A turn is running that this server cannot stream. Nothing will deliver its
   * result to this client, so the UI shows a waiting state until the run is
   * cancelled or the session is reloaded.
   */
  const markResumeUnavailable = useCallback((value: boolean) => {
    resumeUnavailableRef.current = value;
    setResumeUnavailable(value);
  }, []);

  const projectOptions = useMemo(
    () => ({
      getCreatedAt: (messageId: string, fallback: Date, replace = false) => {
        const cache = createdAtByMessageIdRef.current;
        const existing = cache.get(messageId);
        if (existing != null && (!replace || existing.getTime() === fallback.getTime())) {
          return existing;
        }
        cache.set(messageId, fallback);
        return fallback;
      },
    }),
    [],
  );

  const messages = useMemo(() => projectSessionMessages(snapshot, projectOptions), [snapshot, projectOptions]);

  const runStream = useCallback(
    (
      createStream: (signal: AbortSignal) => AsyncGenerator<TurnStreamUpdate>,
      /**
       * A mutable ref whose `.current` is the turn ID to use for
       * `activeStream.turnId`. Callers that capture the gateway turn ID
       * via `onTurnIdAvailable` update this ref in-place so that both the
       * pending-update flush and `commitActiveStream` always see the real
       * gateway ID rather than the locally-generated optimistic one.
       */
      turnIdRef: { current: string },
      isContinuation: boolean,
    ): Promise<void> => {
      const streamGeneration = ++streamGenerationRef.current;
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setIsRunning(true);
      // This stream's `finally` owns the running flag from here on.
      markResumeUnavailable(false);

      const run = (async () => {
        // Sub-agent turns can emit 100+ stream events per frame. Coalesce to one
        // setSnapshot per animation frame so assistant-ui does not remount the whole
        // message tree (UI hang). The buffer belongs to this stream only.
        let pendingStreamUpdate: {
          update: TurnStreamUpdate;
          isContinuation: boolean;
        } | null = null;
        let streamUpdateRaf: number | null = null;

        const flushPendingStreamUpdate = () => {
          streamUpdateRaf = null;
          const pending = pendingStreamUpdate;
          pendingStreamUpdate = null;
          if (pending == null || streamGeneration !== streamGenerationRef.current) {
            return;
          }
          const { update, isContinuation: pendingIsContinuation } = pending;
          setSnapshot(prev =>
            replaceSessionSnapshot(prev, {
              activeStream: {
                // Read from the ref so we always use the latest ID,
                // including any gateway ID that arrived after the RAf
                // was scheduled.
                turnId: turnIdRef.current,
                update,
                isContinuation: pendingIsContinuation,
              },
            }),
          );
        };

        const applyStreamUpdate = (update: TurnStreamUpdate) => {
          pendingStreamUpdate = { update, isContinuation };
          streamUpdateRaf ??= requestAnimationFrame(flushPendingStreamUpdate);
        };

        try {
          for await (const update of createStream(abortController.signal)) {
            if (abortController.signal.aborted) {
              return;
            }
            applyStreamUpdate(update);
          }
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') {
            return;
          }
          onErrorRef.current?.(error);
          throw error;
        } finally {
          cancelScheduledAnimationFrame(streamUpdateRaf);
          if (streamGeneration === streamGenerationRef.current) {
            flushPendingStreamUpdate();
            if (abortControllerRef.current === abortController) {
              abortControllerRef.current = null;
            }
            setIsRunning(false);
            setSnapshot(prev => {
              if (prev.activeStream == null) {
                return prev;
              }
              const marked = replaceSessionSnapshot(prev, {
                activeStream: {
                  ...prev.activeStream,
                  streamComplete: true,
                },
                requiredActions: {
                  approvals: new Map(),
                  toolResponses: new Map(),
                },
              });
              return commitActiveStream(marked);
            });
          }
        }
      })();

      activeRunRef.current = run;
      void run
        .catch(() => undefined)
        .finally(() => {
          if (activeRunRef.current === run) {
            activeRunRef.current = null;
          }
        });
      return run;
    },
    [onError],
  );

  const load = useCallback(async () => {
    // Reading the retry counter intentionally makes retryLoad recreate this callback.
    void loadRetryTrigger;
    if (sessionId == null) {
      createdAtByMessageIdRef.current = new Map();
      setSnapshot(createEmptySessionSnapshot());
      return;
    }

    // Allow the URL-selected session one early load before assistant-ui marks
    // it main. Suppress only that first promotion; later selections still reload.
    const isEarlyInitialLoad =
      isMain === false && isInitialSession === true && initialLoadStartedForRef.current !== sessionId;
    if (isMain === false) {
      if (!isEarlyInitialLoad) {
        return;
      }
      initialLoadStartedForRef.current = sessionId;
      skipInitialPromotionLoadForRef.current = sessionId;
    } else if (isMain === true && skipInitialPromotionLoadForRef.current === sessionId) {
      skipInitialPromotionLoadForRef.current = undefined;
      return;
    }
    if (isInitialSession === true) {
      initialLoadStartedForRef.current = sessionId;
    }

    // When we are loading a *different* session the user has navigated away
    // from the lazily-created one — clear the guard so navigating back to it
    // later triggers a proper reload instead of silently skipping.
    if (lazilyCreatedSessionIdRef.current != null && sessionId !== lazilyCreatedSessionIdRef.current) {
      lazilyCreatedSessionIdRef.current = undefined;
    }

    if (sessionId === lazilyCreatedSessionIdRef.current) {
      return;
    }

    const generation = ++loadGenerationRef.current;
    ++streamGenerationRef.current;
    setIsRunning(false);
    markResumeUnavailable(false);
    abortControllerRef.current?.abort();
    loadOlderInflightRef.current = null;
    createdAtByMessageIdRef.current = new Map();
    setSnapshot(createEmptySessionSnapshot());
    setIsLoading(true);
    setIsLoadingOlderHistory(false);

    try {
      const conversationSessionId = await resolveActiveSessionId(sessionId, resolveConversationSessionIdRef.current);
      const loadedSnapshot = await loadSessionSnapshot(server, conversationSessionId, snap => {
        if (generation === loadGenerationRef.current) {
          setSnapshot(snap);
        }
      });
      if (generation !== loadGenerationRef.current) {
        return;
      }

      createdAtByMessageIdRef.current = new Map();
      setSnapshot(loadedSnapshot);
      runningTurnRef.current = loadedSnapshot.runningTurn;

      // History (and any seeded pendingUser for the in-flight turn) is
      // ready — clear loading before resuming. Awaiting the subscribe
      // stream here previously kept isLoading true for the entire
      // backend run, so reconnect UIs stayed on shimmers even though
      // subscribe was already live.
      setIsLoading(false);

      if (loadedSnapshot.runningTurn != null) {
        const turn = loadedSnapshot.runningTurn;

        // subscribeToTurn is optional, so a server can leave us without
        // a reconnect path. The turn still runs on the backend: show the
        // loaded history as running and let the host explain the gap.
        if (server.subscribeToTurn == null) {
          setIsRunning(true);
          markResumeUnavailable(true);
          return;
        }

        const isContinuation = extractTurnUserText(turn.input) === undefined;
        // TODO: pass afterSequenceNumber once stream ingestion tracks sequence numbers.
        // Use loadedSnapshot directly — snapshotRef.current still points at
        // the empty snapshot cleared above until the setSnapshot(loadedSnapshot)
        // call re-renders.
        void runStream(
          signal =>
            resumeTurnStream(
              server,
              conversationSessionId,
              turn.id,
              loadedSnapshot.fold,
              signal,
              undefined,
              loadedSnapshot.groupRootBaseline,
            ),
          { current: turn.id },
          isContinuation,
        ).catch(() => undefined);
      }
    } catch (error) {
      if (generation === loadGenerationRef.current) {
        if (isEarlyInitialLoad) {
          // Allow retryLoad while still backgrounded (before isMain promotion).
          initialLoadStartedForRef.current = undefined;
          skipInitialPromotionLoadForRef.current = undefined;
        }
        onErrorRef.current?.(error);
      }
      throw error;
    } finally {
      if (generation === loadGenerationRef.current) {
        setIsLoading(false);
      }
    }
  }, [server, runStream, sessionId, loadRetryTrigger, isMain, isInitialSession]);

  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const sendTurn = useCallback(
    async (options: SendTurnOptions) => {
      // A turn.created event means the gateway registered the user message.
      // Errors after that point must keep the message in chat.
      const gatewayTurnAccepted = { current: false };
      let pendingUserWasSet = false;
      let runStreamStarted = false;
      let pendingUserTurnId: string | undefined;

      try {
        let activeSessionId = sessionId;
        if (activeSessionId == null) {
          if (initializeSessionRef.current == null) {
            throw new Error('Cannot send a turn without an active session.');
          }
          const { remoteId } = await initializeSessionRef.current();
          activeSessionId = remoteId;
          lazilyCreatedSessionIdRef.current = remoteId;
        }

        const conversationSessionId = await resolveActiveSessionId(
          activeSessionId,
          resolveConversationSessionIdRef.current,
        );
        const turnHeaders = await getTurnHeadersRef.current?.();
        const streamHeaders = turnHeaders != null ? { headers: turnHeaders } : {};
        const isContinuation = 'inputs' in options || ('resumeMcpAuth' in options && options.resumeMcpAuth);
        const continuationTurnId = snapshotRef.current.activeStream?.turnId;
        const turnId = isContinuation
          ? // A paused stream is usually already committed (commitActiveStream
            // cleared activeStream), so continue under the committed turn's
            // real id. Never mint a local id for a continuation — it leaks to
            // the backend via `custom.turnId` (sandbox downloads, edit/retry)
            // as a turn the gateway has never heard of.
            (continuationTurnId ?? snapshotRef.current.turns.at(-1)?.id ?? crypto.randomUUID())
          : crypto.randomUUID();
        // First turns must send previousTurnId: "none".
        const isFirstTurnInSession =
          'userMessage' in options &&
          options.previousTurnId === undefined &&
          snapshotRef.current.turns.length === 0 &&
          snapshotRef.current.pendingUser == null &&
          snapshotRef.current.activeStream == null;

        // Mutable ref so runStream always reads the latest ID. The local
        // placeholder (optimistic `generateId()` or the previous turn's id
        // for continuations) is replaced with the gateway-assigned ID once
        // the first SSE event arrives.
        const turnIdRef = { current: turnId };

        // Renames the placeholder ID to the gateway turn ID so that
        // edit/retry and sandbox downloads can resolve the turn via the
        // gateway. Wired into every stream branch — continuation turns
        // (approval / ask-user / MCP-auth resumes) are new gateway turns
        // too, and committing them under a local id corrupts the record.
        const handleGatewayTurnId = (gatewayTurnId: string) => {
          const oldId = turnIdRef.current;
          // turn.created proves the gateway registered the message.
          gatewayTurnAccepted.current = true;
          if (gatewayTurnId === oldId) {
            return;
          }
          turnIdRef.current = gatewayTurnId;
          // Rename in the ref immediately so any synchronous read
          // (e.g. commitActiveStream) sees the correct ID.
          const renamePendingUser = (prev: SessionSnapshot): SessionSnapshot => {
            if (prev.pendingUser?.turnId !== oldId) {
              return prev;
            }
            return replaceSessionSnapshot(prev, {
              pendingUser: {
                ...prev.pendingUser,
                turnId: gatewayTurnId,
              },
            });
          };
          snapshotRef.current = renamePendingUser(snapshotRef.current);
          setSnapshot(renamePendingUser);
        };

        if ('inputs' in options) {
          applyUserToolResponsesToFold(snapshotRef.current.fold, options.inputs);
        }

        const branchBase = 'userMessage' in options ? options.branchFromSnapshot : undefined;

        let groupRootBaseline: readonly string[] | undefined;

        if (branchBase != null && 'userMessage' in options) {
          // Atomic apply: never merge pendingUser onto a stale React `prev`
          // that still holds pre-branch turns (edit would show old + new).
          const rootBucket = branchBase.fold.threads.get(ROOT_THREAD_ID);
          groupRootBaseline = [...(rootBucket?.modelMessageIds ?? [])];
          const nextSnapshot = replaceSessionSnapshot(branchBase, {
            pendingUser: {
              turnId,
              content: options.userMessage,
              createdAt: new Date(),
            },
            activeStream: undefined,
            groupRootBaseline,
          });
          snapshotRef.current = nextSnapshot;
          setSnapshot(nextSnapshot);
          pendingUserWasSet = true;
          pendingUserTurnId = turnId;
        } else {
          setSnapshot(prev => commitActiveStream(prev, 'inputs' in options ? options.inputs : undefined));

          if ('userMessage' in options) {
            const rootBucket = snapshotRef.current.fold.threads.get(ROOT_THREAD_ID);
            groupRootBaseline = [...(rootBucket?.modelMessageIds ?? [])];
            setSnapshot(prev => {
              const next = replaceSessionSnapshot(prev, {
                pendingUser: {
                  turnId,
                  content: options.userMessage,
                  createdAt: new Date(),
                },
                activeStream: undefined,
                groupRootBaseline,
              });
              snapshotRef.current = next;
              return next;
            });
            pendingUserWasSet = true;
            pendingUserTurnId = turnId;
          } else {
            groupRootBaseline =
              snapshotRef.current.groupRootBaseline ?? computeGroupRootBaseline(snapshotRef.current.turns);
          }
        }

        runStreamStarted = true;
        await runStream(
          signal => {
            if ('inputs' in options) {
              return streamTurnContent(
                server,
                conversationSessionId,
                snapshotRef.current.fold,
                { inputs: options.inputs, ...streamHeaders },
                signal,
                groupRootBaseline,
                handleGatewayTurnId,
              );
            }
            if ('resumeMcpAuth' in options) {
              return streamTurnContent(
                server,
                conversationSessionId,
                snapshotRef.current.fold,
                { resumeMcpAuth: true, ...streamHeaders },
                signal,
                groupRootBaseline,
                handleGatewayTurnId,
              );
            }
            return streamTurnContent(
              server,
              conversationSessionId,
              snapshotRef.current.fold,
              {
                userMessage: options.userMessage,
                ...(options.previousTurnId !== undefined
                  ? { previousTurnId: options.previousTurnId ?? 'none' }
                  : isFirstTurnInSession
                    ? { previousTurnId: 'none' }
                    : {}),
                ...streamHeaders,
              },
              signal,
              groupRootBaseline,
              handleGatewayTurnId,
            );
          },
          turnIdRef,
          isContinuation,
        );
      } catch (error) {
        if ('userMessage' in options && !gatewayTurnAccepted.current) {
          const branchRollbackSnapshot = options.branchRollbackSnapshot;
          const canRestoreBranch =
            branchRollbackSnapshot != null &&
            (snapshotRef.current === options.branchFromSnapshot ||
              snapshotRef.current.pendingUser?.turnId === pendingUserTurnId);
          if (canRestoreBranch) {
            snapshotRef.current = branchRollbackSnapshot;
            setSnapshot(branchRollbackSnapshot);
          } else if (pendingUserWasSet) {
            const clearPendingUser = (previous: SessionSnapshot): SessionSnapshot => {
              if (previous.pendingUser?.turnId !== pendingUserTurnId) {
                return previous;
              }
              return replaceSessionSnapshot(previous, {
                pendingUser: undefined,
              });
            };
            snapshotRef.current = clearPendingUser(snapshotRef.current);
            setSnapshot(clearPendingUser);
          }
          options.onPreTurnFailure?.();
        }
        if (!runStreamStarted) {
          onErrorRef.current?.(error);
        }
        throw error;
      }
    },
    [server, runStream, sessionId],
  );

  const cancel = useCallback(async () => {
    // A turn can start before the thread list publishes `remoteId`, and that
    // run still has a backend session to stop.
    const activeSessionId = sessionId ?? lazilyCreatedSessionIdRef.current;
    if (activeSessionId == null) {
      abortControllerRef.current?.abort();
      return;
    }
    const conversationSessionId = await resolveActiveSessionId(
      activeSessionId,
      resolveConversationSessionIdRef.current,
    );
    // Request cancellation but keep consuming the stream. After cancel(),
    // the backend gracefully closes the SSE stream: it emits a terminal
    // turn.done event and then ends the stream, which lets the active run
    // drain to completion on its own instead of being torn down mid-flight.
    await server.cancelSession({ sessionId: conversationSessionId }).catch(() => undefined);
    // Wait for the in-flight stream to finish draining. No explicit
    // reconcile is needed here — the cancelled turn is terminal and local
    // state reconciles against the event log on the next session load.
    await activeRunRef.current?.catch(() => undefined);
    // Nothing drained when the load could not attach a stream, so clear the
    // running flag here or the composer stays blocked until a reload.
    if (resumeUnavailableRef.current) {
      markResumeUnavailable(false);
      setIsRunning(false);
    }
  }, [server, sessionId, markResumeUnavailable]);

  const isRunningRef = useRef(isRunning);
  isRunningRef.current = isRunning;

  const trySendCollectedRequiredActions = useCallback(
    (nextSnapshot: SessionSnapshot) => {
      if (isRunningRef.current) {
        return;
      }
      const projected = projectSessionMessages(nextSnapshot, projectOptions);
      const paused = findPausedAssistantMessage(projected);
      if (paused == null || messageHasPendingRequiredActions(paused)) {
        return;
      }
      const inputs = collectRequiredActionInputs(paused);
      if (inputs.length > 0) {
        // sendTurn/runStream already report via onError; swallow to avoid duplicates.
        void sendTurn({ inputs }).catch(() => undefined);
      }
    },
    [projectOptions, sendTurn],
  );

  const respondToToolApproval = useCallback(
    (response: RespondToToolApprovalOptions) => {
      const prev = snapshotRef.current;
      const approvals = new Map(prev.requiredActions.approvals);
      approvals.set(response.approvalId, {
        approved: response.approved,
        ...(response.reason != null ? { reason: response.reason } : {}),
      });
      const nextSnapshot = replaceSessionSnapshot(prev, {
        requiredActions: {
          ...prev.requiredActions,
          approvals,
        },
      });
      setSnapshot(nextSnapshot);
      trySendCollectedRequiredActions(nextSnapshot);
    },
    [trySendCollectedRequiredActions],
  );

  const respondToToolResponse = useCallback(
    (response: RespondToToolResponseOptions) => {
      const prev = snapshotRef.current;
      const toolResponses = new Map(prev.requiredActions.toolResponses);
      toolResponses.set(response.toolCallId, { content: response.content });
      const nextSnapshot = replaceSessionSnapshot(prev, {
        requiredActions: {
          ...prev.requiredActions,
          toolResponses,
        },
      });
      setSnapshot(nextSnapshot);
      trySendCollectedRequiredActions(nextSnapshot);
    },
    [trySendCollectedRequiredActions],
  );

  const resumeRun = useCallback(async () => {
    const turn = runningTurnRef.current;
    if (turn == null) {
      return;
    }
    if (server.subscribeToTurn == null) {
      markResumeUnavailable(true);
      return;
    }
    // TODO: pass afterSequenceNumber once stream ingestion tracks sequence numbers.
    await runStream(
      signal =>
        resumeTurnStream(
          server,
          turn.sessionId,
          turn.id,
          snapshotRef.current.fold,
          signal,
          undefined,
          snapshotRef.current.groupRootBaseline,
        ),
      { current: turn.id },
      true,
    );
  }, [runStream, server]);

  const branchFromTurn = useCallback(
    async (turnId: string, userMessage: UserMessageContent) => {
      let committed: SessionSnapshot;
      let previousTurnId: string;
      let rewound: SessionSnapshot;
      try {
        const activeSessionId = sessionId;
        if (activeSessionId == null) {
          throw new Error('Cannot branch from a turn without an active session.');
        }

        committed = commitActiveStream(snapshotRef.current);
        setSnapshot(committed);

        await cancel();

        const conversationSessionId = await resolveActiveSessionId(
          activeSessionId,
          resolveConversationSessionIdRef.current,
        );
        previousTurnId = await resolveGatewayBranchPreviousTurnIdForTurn(server, conversationSessionId, turnId);
        // Rewind to the exact parent used for the new branch. Using the
        // previous item from listTurns could select an abandoned branch.
        rewound = await buildSnapshotThroughTurn(
          server,
          conversationSessionId,
          previousTurnId === 'none' ? null : previousTurnId,
        );
        createdAtByMessageIdRef.current = new Map();
        // Keep the ref aligned before awaiting sendTurn so any intermediate
        // reads (and the atomic pendingUser apply) see the rewound history.
        snapshotRef.current = rewound;
        setSnapshot(rewound);
      } catch (error) {
        // Setup failures never reach sendTurn/runStream reporting.
        onErrorRef.current?.(error);
        throw error;
      }

      // sendTurn/runStream own error reporting for the turn itself.
      await sendTurn({
        userMessage,
        previousTurnId,
        branchFromSnapshot: rewound,
        branchRollbackSnapshot: committed,
      });
    },
    [cancel, server, sendTurn, sessionId],
  );

  const resetFromTurn = useCallback(
    async (turnId: string) => {
      const committed = commitActiveStream(snapshotRef.current);
      const originalInput = resolveTurnInput(committed, turnId);
      if (originalInput == null) {
        const error = new Error(`Turn ${turnId} not found in session snapshot`);
        onErrorRef.current?.(error);
        throw error;
      }
      const userMessage = extractTurnUserMessageContent(originalInput);
      await branchFromTurn(turnId, userMessage);
    },
    [branchFromTurn],
  );

  const editFromTurn = useCallback(
    async (turnId: string, editedText: string) => {
      const committed = commitActiveStream(snapshotRef.current);
      const originalInput = resolveTurnInput(committed, turnId);
      if (originalInput == null) {
        const error = new Error(`Turn ${turnId} not found in session snapshot`);
        onErrorRef.current?.(error);
        throw error;
      }
      const userMessage = buildEditedUserMessageContent(editedText, originalInput);
      await branchFromTurn(turnId, userMessage);
    },
    [branchFromTurn],
  );

  const retryLoad = useCallback(() => {
    setLoadRetryTrigger(n => n + 1);
  }, []);

  const hasOlderHistory = snapshot.historyPagination?.hasOlder === true;

  const loadOlderHistory = useCallback(async () => {
    if (sessionId == null || isMain === false) {
      return;
    }
    const requestedSessionId = sessionId;
    // Stale closure from a prior session — do not touch the live snapshot.
    if (sessionIdRef.current !== requestedSessionId) {
      return;
    }
    if (loadOlderInflightRef.current != null) {
      return loadOlderInflightRef.current;
    }

    const current = snapshotRef.current;
    if (current.historyPagination?.hasOlder !== true) {
      return;
    }
    if (current.historyPagination.olderPageToken == null) {
      return;
    }

    const generation = loadGenerationRef.current;
    setIsLoadingOlderHistory(true);

    const run = (async () => {
      const stillCurrent = () =>
        generation === loadGenerationRef.current && sessionIdRef.current === requestedSessionId;
      try {
        const conversationSessionId = await resolveActiveSessionId(
          requestedSessionId,
          resolveConversationSessionIdRef.current,
        );
        if (!stillCurrent()) {
          return;
        }
        const next = await prependOlderSessionHistory(server, conversationSessionId, snapshotRef.current);
        if (!stillCurrent()) {
          return;
        }
        // Keep the ref in sync before the next render so awaiting
        // callers (e.g. resolveSandboxIdForTurn) see the merged history.
        snapshotRef.current = next;
        setSnapshot(next);
      } catch (error) {
        if (stillCurrent()) {
          onErrorRef.current?.(error);
        }
        throw error;
      } finally {
        if (stillCurrent()) {
          setIsLoadingOlderHistory(false);
        }
        loadOlderInflightRef.current = null;
      }
    })();

    loadOlderInflightRef.current = run;
    return run;
  }, [server, isMain, sessionId]);

  /**
   * Resolves the sandbox that was current as of `turnId`, paging in older
   * history when the `sandbox.created` reference predates the loaded window
   * (deriving it from loaded messages alone caused spurious "No sandbox is
   * available yet" failures on long sessions).
   */
  const resolveSandboxIdForTurn = useCallback(
    async (turnId: string): Promise<string | undefined> => {
      const generation = loadGenerationRef.current;
      const requestedSessionId = sessionId;
      const stillCurrent = () =>
        generation === loadGenerationRef.current && sessionIdRef.current === requestedSessionId;

      if (!stillCurrent()) {
        return undefined;
      }

      let sandboxId = findSandboxIdInSnapshot(snapshotRef.current, turnId);
      // ponytail: bounded linear page-in — the gateway has no direct
      // session→sandbox lookup; a backend lookup route is the upgrade path.
      for (
        let i = 0;
        sandboxId == null &&
        stillCurrent() &&
        snapshotRef.current.historyPagination?.hasOlder === true &&
        i < MAX_SANDBOX_HISTORY_PAGE_INS;
        i++
      ) {
        await loadOlderHistory();
        if (!stillCurrent()) {
          return undefined;
        }
        sandboxId = findSandboxIdInSnapshot(snapshotRef.current, turnId);
      }
      return stillCurrent() ? sandboxId : undefined;
    },
    [loadOlderHistory, sessionId],
  );

  return {
    messages,
    isRunning,
    resumeUnavailable,
    isLoading,
    isLoadingOlderHistory,
    hasOlderHistory,
    loadOlderHistory,
    resolveSandboxIdForTurn,
    retryLoad,
    sendTurn,
    cancel,
    respondToToolApproval,
    respondToToolResponse,
    resumeRun,
    branchFromTurn,
    resetFromTurn,
    editFromTurn,
  };
}

export { findPausedAssistantMessage, MCP_AUTH_RESUME_RUN_CUSTOM_KEY };
