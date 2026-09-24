'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  Turn,
  TurnInboundEventItem,
  TurnInputItem,
  UserMcpAuthContinueInputEvent,
  UserMessageContent,
  UserToolApprovalInputEvent,
  UserToolResponseInputEvent,
} from './server/index.js';
import { EVENT_TYPE, TURN_STATUS } from './server/index.js';
import type { AgentChatServer } from './server/types.js';

import { collectPendingApprovals, collectPendingToolResponses } from './collectPending.js';
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
} from './convertTurnMessages.js';
import { ingestTurnEvent } from './foldPeerThreads.js';
import { loadSessionSnapshot } from './loadSessionSnapshot.js';
import { MESSAGE_CUSTOM_KEY } from './messageCustomMetadata.js';
import { findPausedAssistantMessage } from './requiredActionInputs.js';
import {
  createEmptySessionSnapshot,
  replaceSessionSnapshot,
  STREAM_SEGMENT_STATUS,
  streamSegmentStatus,
  type SessionSnapshot,
  type SessionTurnRecord,
} from './sessionSnapshot.js';
import { resumeTurnStream, streamTurnContent } from './streamTurn.js';
import { mapApprovalDecision, type RespondToToolApprovalOptions } from './toolApproval.js';
import { type RespondToToolResponseOptions } from './toolResponse.js';
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

export interface SendTurnOptions {
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

interface ActiveRun {
  promise: Promise<void>;
  transport: 'create' | 'subscribe';
  turnIdRef: { current: string };
}

interface QueuedSubscription {
  turnId: string;
  promise: Promise<void>;
}

interface RunStreamOptions {
  initiallyRunning: boolean;
  transport: ActiveRun['transport'];
}

function buildUserTurnInput(content: UserMessageContent): TurnInputItem {
  return { type: EVENT_TYPE.USER_MESSAGE, content };
}

function cancelScheduledAnimationFrame(frame: number | null): void {
  if (frame != null) {
    cancelAnimationFrame(frame);
  }
}

function commitActiveStream(snapshot: SessionSnapshot): SessionSnapshot {
  const active = snapshot.activeStream;
  const terminalState = active?.update.turnState;
  if (
    active?.segmentStatus !== STREAM_SEGMENT_STATUS.TERMINAL ||
    terminalState == null ||
    terminalState.status === TURN_STATUS.RUNNING ||
    terminalState.status === TURN_STATUS.PAUSED
  ) {
    return snapshot;
  }

  const activeSandboxIdValue = active.update.metadata?.custom?.[MESSAGE_CUSTOM_KEY.SANDBOX_ID];
  const activeSandboxId = typeof activeSandboxIdValue === 'string' ? activeSandboxIdValue : undefined;

  const baseline = snapshot.groupRootBaseline ?? computeGroupRootBaseline(snapshot.turns);
  const rootModelMessageIds = rootModelMessageIdsSinceBaseline(snapshot.fold, baseline);

  const lastTurn = snapshot.turns.at(-1);
  if (lastTurn?.id === active.turnId) {
    return replaceSessionSnapshot(snapshot, {
      turns: snapshot.turns.map(turn =>
        turn.id === active.turnId
          ? {
              ...turn,
              state: terminalState,
              rootModelMessageIds,
              ...(activeSandboxId != null ? { sandboxId: activeSandboxId } : {}),
            }
          : turn,
      ),
      pendingUser: undefined,
      activeTurn: undefined,
      // Custom stream adapters may yield projected content without fold events.
      // Keep that completed projection until the next stream replaces it.
      ...(rootModelMessageIds.length > 0 ? { activeStream: undefined } : {}),
    });
  }

  const record: SessionTurnRecord = {
    id: active.turnId,
    createdAt: snapshot.pendingUser?.createdAt.toISOString() ?? new Date().toISOString(),
    state: terminalState,
    input: snapshot.pendingUser ? [buildUserTurnInput(snapshot.pendingUser.content)] : [],
    ...(snapshot.pendingUser ? { userText: userMessageContentToText(snapshot.pendingUser.content) } : {}),
    rootModelMessageIds,
    ...(activeSandboxId != null ? { sandboxId: activeSandboxId } : {}),
  };

  return replaceSessionSnapshot(snapshot, {
    turns: [...snapshot.turns, record],
    pendingUser: undefined,
    activeTurn: undefined,
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
    const sandboxId = active.update.metadata?.custom?.[MESSAGE_CUSTOM_KEY.SANDBOX_ID];
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
    return [{ type: EVENT_TYPE.USER_MESSAGE, content: snapshot.pendingUser.content }];
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
  const activeRunRef = useRef<ActiveRun | null>(null);
  const queuedSubscriptionRef = useRef<QueuedSubscription | null>(null);
  const activeTurnRef = useRef<Turn | undefined>(undefined);
  const actionSubmissionsRef = useRef(new Set<string>());
  const loadGenerationRef = useRef(0);
  const streamGenerationRef = useRef(0);
  const lazilyCreatedSessionIdRef = useRef<string | undefined>(undefined);
  const initialLoadStartedForRef = useRef<string | undefined>(undefined);
  const skipInitialPromotionLoadForRef = useRef<string | undefined>(undefined);

  const updateSnapshot = useCallback((update: (previous: SessionSnapshot) => SessionSnapshot): SessionSnapshot => {
    const next = update(snapshotRef.current);
    snapshotRef.current = next;
    activeTurnRef.current = next.activeTurn;
    setSnapshot(next);
    return next;
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
      options: RunStreamOptions,
    ): Promise<void> => {
      const streamGeneration = ++streamGenerationRef.current;
      abortControllerRef.current?.abort();
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setIsRunning(options.initiallyRunning);

      const run = (async () => {
        // Sub-agent turns can emit 100+ stream events per frame. Coalesce to one
        // setSnapshot per animation frame so assistant-ui does not remount the whole
        // message tree (UI hang). The buffer belongs to this stream only.
        let pendingStreamUpdate: TurnStreamUpdate | null = null;
        let streamUpdateRaf: number | null = null;
        let terminalErrorReported = false;

        const flushPendingStreamUpdate = () => {
          streamUpdateRaf = null;
          const pending = pendingStreamUpdate;
          pendingStreamUpdate = null;
          if (pending == null || streamGeneration !== streamGenerationRef.current) {
            return;
          }
          const update = pending;
          const turnState = update.turnState;
          const segmentStatus = streamSegmentStatus({ turnState });
          if (turnState != null) {
            setIsRunning(turnState.status === TURN_STATUS.RUNNING);
          }
          if (turnState?.status === TURN_STATUS.ERROR && !terminalErrorReported) {
            terminalErrorReported = true;
            onErrorRef.current?.(new Error(turnState.message));
          }
          updateSnapshot(prev => {
            const activeTurn =
              prev.activeTurn?.id === turnIdRef.current && turnState != null
                ? { ...prev.activeTurn, state: turnState }
                : prev.activeTurn;
            const next = replaceSessionSnapshot(prev, {
              activeStream: {
                turnId: turnIdRef.current,
                update,
                segmentStatus,
                ...(update.sequenceNumber != null ? { lastSequenceNumber: update.sequenceNumber } : {}),
              },
              ...(activeTurn != null ? { activeTurn } : {}),
              ...(turnState != null && turnState.status !== TURN_STATUS.PAUSED
                ? {
                    requiredActions: {
                      approvals: new Map(),
                      toolResponses: new Map(),
                    },
                  }
                : {}),
            });
            return next;
          });
        };

        const applyStreamUpdate = (update: TurnStreamUpdate) => {
          pendingStreamUpdate = update;
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
            updateSnapshot(prev => {
              if (prev.activeStream == null) {
                return prev;
              }
              const state = prev.activeStream.update.turnState;
              const segmentStatus = streamSegmentStatus({ turnState: state, segmentEnded: true });
              const marked = replaceSessionSnapshot(prev, {
                activeStream: {
                  ...prev.activeStream,
                  segmentStatus,
                },
              });
              return commitActiveStream(marked);
            });
            setIsRunning(false);
          }
        }
      })();

      const activeRun: ActiveRun = { promise: run, transport: options.transport, turnIdRef };
      activeRunRef.current = activeRun;
      void run
        .catch(() => undefined)
        .finally(() => {
          if (activeRunRef.current === activeRun) {
            activeRunRef.current = null;
          }
        });
      return run;
    },
    [updateSnapshot],
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
      activeTurnRef.current = loadedSnapshot.activeTurn;

      // History (and any seeded pendingUser for the in-flight turn) is
      // ready — clear loading before resuming. Awaiting the subscribe
      // stream here previously kept isLoading true for the entire
      // backend run, so reconnect UIs stayed on shimmers even though
      // subscribe was already live.
      setIsLoading(false);

      if (loadedSnapshot.activeTurn != null) {
        const turn = loadedSnapshot.activeTurn;
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
          {
            initiallyRunning: turn.state.status === TURN_STATUS.RUNNING,
            transport: 'subscribe',
          },
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
        const turnId = crypto.randomUUID();
        // First turns must send previousTurnId: "none".
        const isFirstTurnInSession =
          options.previousTurnId === undefined &&
          snapshotRef.current.turns.length === 0 &&
          snapshotRef.current.pendingUser == null &&
          snapshotRef.current.activeStream == null;

        // Mutable ref so runStream always reads the latest ID. The local
        // placeholder is replaced with the gateway-assigned ID once the first
        // SSE event arrives.
        const turnIdRef: { current: string } = { current: turnId };

        const handleGatewayTurnId = (gatewayTurnId: string) => {
          const oldId = turnIdRef.current;
          gatewayTurnAccepted.current = true;
          turnIdRef.current = gatewayTurnId;
          const registerActiveTurn = (prev: SessionSnapshot): SessionSnapshot => {
            const pendingUser = prev.pendingUser?.turnId === oldId ? prev.pendingUser : undefined;
            const activeTurn: Turn = {
              id: gatewayTurnId,
              sessionId: conversationSessionId,
              previousTurnId: options.previousTurnId ?? (isFirstTurnInSession ? 'none' : 'auto'),
              input: [{ type: EVENT_TYPE.USER_MESSAGE, content: options.userMessage }],
              state: { status: TURN_STATUS.RUNNING },
              createdAt: pendingUser?.createdAt.toISOString() ?? new Date().toISOString(),
            };
            return replaceSessionSnapshot(prev, {
              activeTurn,
              ...(pendingUser != null
                ? {
                    pendingUser: {
                      ...pendingUser,
                      turnId: gatewayTurnId,
                    },
                  }
                : {}),
            });
          };
          snapshotRef.current = registerActiveTurn(snapshotRef.current);
          activeTurnRef.current = snapshotRef.current.activeTurn;
          setSnapshot(snapshotRef.current);
        };

        const branchBase = options.branchFromSnapshot;

        let groupRootBaseline: readonly string[] | undefined;

        if (branchBase != null) {
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
          updateSnapshot(prev => commitActiveStream(prev));

          const rootBucket = snapshotRef.current.fold.threads.get(ROOT_THREAD_ID);
          groupRootBaseline = [...(rootBucket?.modelMessageIds ?? [])];
          updateSnapshot(prev =>
            replaceSessionSnapshot(prev, {
              pendingUser: {
                turnId,
                content: options.userMessage,
                createdAt: new Date(),
              },
              activeStream: undefined,
              activeTurn: undefined,
              groupRootBaseline,
            }),
          );
          pendingUserWasSet = true;
          pendingUserTurnId = turnId;
        }

        runStreamStarted = true;
        await runStream(
          signal =>
            streamTurnContent(
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
            ),
          turnIdRef,
          { initiallyRunning: true, transport: 'create' },
        );
      } catch (error) {
        if (!gatewayTurnAccepted.current) {
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
            setSnapshot(snapshotRef.current);
          }
          options.onPreTurnFailure?.();
        }
        if (!runStreamStarted) {
          onErrorRef.current?.(error);
        }
        throw error;
      }
    },
    [server, runStream, sessionId, updateSnapshot],
  );

  const ensureTurnSubscription = useCallback(
    ({ conversationSessionId, turnId }: { conversationSessionId: string; turnId: string }): Promise<void> => {
      const startSubscription = () => {
        const latest = snapshotRef.current.activeStream;
        const afterSequenceNumber = latest?.turnId === turnId ? latest.lastSequenceNumber : undefined;
        // Subscribe first so either valid server ordering (subscribe-before-send
        // or a concurrently arriving POST) cannot leave a replay gap.
        void runStream(
          signal =>
            resumeTurnStream(
              server,
              conversationSessionId,
              turnId,
              snapshotRef.current.fold,
              signal,
              afterSequenceNumber,
              snapshotRef.current.groupRootBaseline,
            ),
          { current: turnId },
          { initiallyRunning: false, transport: 'subscribe' },
        ).catch(() => undefined);
      };

      const currentRun = activeRunRef.current;
      if (currentRun == null) {
        startSubscription();
        return Promise.resolve();
      }

      const currentIsSameTurn = currentRun.turnIdRef.current === turnId;
      const currentIsLive = currentIsSameTurn && currentRun.transport === 'subscribe';
      if (currentIsLive) {
        return Promise.resolve();
      }

      const queued = queuedSubscriptionRef.current;
      if (queued?.turnId === turnId) {
        return queued.promise;
      }

      const promise = (async () => {
        await currentRun.promise.catch(() => undefined);
        await Promise.resolve();
        const latestTurn = snapshotRef.current.activeTurn;
        if (
          activeRunRef.current == null &&
          latestTurn?.id === turnId &&
          (latestTurn.state.status === TURN_STATUS.RUNNING || latestTurn.state.status === TURN_STATUS.PAUSED)
        ) {
          startSubscription();
        }
      })();
      const queuedSubscription: QueuedSubscription = { turnId, promise };
      queuedSubscriptionRef.current = queuedSubscription;
      void promise.finally(() => {
        if (queuedSubscriptionRef.current === queuedSubscription) {
          queuedSubscriptionRef.current = null;
        }
      });
      return promise;
    },
    [runStream, server],
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
    const activeTurn = snapshotRef.current.activeTurn;
    if (activeTurn?.state.status === TURN_STATUS.PAUSED) {
      await ensureTurnSubscription({ conversationSessionId, turnId: activeTurn.id });
    }
    try {
      // Cancellation remains server-authoritative. The attached subscription
      // delivers the cancelled turn.done for both running and paused turns.
      await server.cancelSession({ sessionId: conversationSessionId });
    } catch (error) {
      onErrorRef.current?.(error);
      throw error;
    }
    await activeRunRef.current?.promise.catch(() => undefined);
    setIsRunning(false);
  }, [ensureTurnSubscription, server, sessionId]);

  const submitTurnEvent = useCallback(
    async ({
      event,
      submissionId,
      optimisticSnapshot,
    }: {
      event: TurnInboundEventItem;
      submissionId: string;
      optimisticSnapshot: SessionSnapshot;
    }): Promise<void> => {
      if (actionSubmissionsRef.current.has(submissionId)) {
        return;
      }
      const activeSessionId = sessionId ?? lazilyCreatedSessionIdRef.current;
      const active = snapshotRef.current.activeStream;
      const activeTurn = snapshotRef.current.activeTurn;
      const turnId = active?.turnId ?? activeTurn?.id;
      if (activeSessionId == null || turnId == null) {
        throw new Error('Cannot send a required-action event without an active turn.');
      }

      actionSubmissionsRef.current.add(submissionId);
      snapshotRef.current = optimisticSnapshot;
      setSnapshot(optimisticSnapshot);
      try {
        const conversationSessionId = await resolveActiveSessionId(
          activeSessionId,
          resolveConversationSessionIdRef.current,
        );
        void ensureTurnSubscription({ conversationSessionId, turnId });
        const created = await server.sendTurnEvents({
          sessionId: conversationSessionId,
          turnId,
          events: [event],
        });
        updateSnapshot(previous => {
          for (const persisted of created) {
            ingestTurnEvent(previous.fold, persisted);
          }
          // Keep the optimistic overlay through partial pauses. Some custom
          // hosts return persisted user events before replaying the source
          // model message into the fold; the server's running update is the
          // authoritative point where every resolved overlay can be cleared.
          return replaceSessionSnapshot(previous, {});
        });
      } catch (error) {
        updateSnapshot(previous => {
          const approvals = new Map(previous.requiredActions.approvals);
          const toolResponses = new Map(previous.requiredActions.toolResponses);
          if (event.type === EVENT_TYPE.USER_TOOL_APPROVAL) {
            approvals.delete(event.toolCallId);
          } else if (event.type === EVENT_TYPE.USER_TOOL_RESPONSE) {
            toolResponses.delete(event.toolCallId);
          }
          return replaceSessionSnapshot(previous, {
            requiredActions: { approvals, toolResponses },
          });
        });
        onErrorRef.current?.(error);
        throw error;
      } finally {
        actionSubmissionsRef.current.delete(submissionId);
      }
    },
    [ensureTurnSubscription, server, sessionId, updateSnapshot],
  );

  const respondToToolApproval = useCallback(
    async (response: RespondToToolApprovalOptions): Promise<void> => {
      const previous = snapshotRef.current;
      const pending = collectPendingApprovals(projectSessionMessages(previous, projectOptions)).find(
        item => item.approvalId === response.approvalId,
      );
      if (pending == null) {
        throw new Error(`Pending approval not found: ${response.approvalId}`);
      }
      const event: UserToolApprovalInputEvent = {
        type: EVENT_TYPE.USER_TOOL_APPROVAL,
        threadId: pending.threadId,
        toolCallId: response.approvalId,
        approval: mapApprovalDecision(response.approved, response.reason),
      };
      const approvals = new Map(previous.requiredActions.approvals);
      approvals.set(response.approvalId, {
        approved: response.approved,
        ...(response.reason != null ? { reason: response.reason } : {}),
      });
      await submitTurnEvent({
        event,
        submissionId: `approval:${response.approvalId}`,
        optimisticSnapshot: replaceSessionSnapshot(previous, {
          requiredActions: { ...previous.requiredActions, approvals },
        }),
      });
    },
    [projectOptions, submitTurnEvent],
  );

  const respondToToolResponse = useCallback(
    async (response: RespondToToolResponseOptions): Promise<void> => {
      const previous = snapshotRef.current;
      const pending = collectPendingToolResponses(projectSessionMessages(previous, projectOptions)).find(
        item => item.toolCallId === response.toolCallId,
      );
      if (pending == null) {
        throw new Error(`Pending tool response not found: ${response.toolCallId}`);
      }
      const event: UserToolResponseInputEvent = {
        type: EVENT_TYPE.USER_TOOL_RESPONSE,
        threadId: pending.threadId,
        toolCallId: response.toolCallId,
        content: response.content,
      };
      const toolResponses = new Map(previous.requiredActions.toolResponses);
      toolResponses.set(response.toolCallId, { content: response.content });
      await submitTurnEvent({
        event,
        submissionId: `response:${response.toolCallId}`,
        optimisticSnapshot: replaceSessionSnapshot(previous, {
          requiredActions: { ...previous.requiredActions, toolResponses },
        }),
      });
    },
    [projectOptions, submitTurnEvent],
  );

  const continueMcpAuth = useCallback(async (): Promise<void> => {
    const event: UserMcpAuthContinueInputEvent = { type: EVENT_TYPE.USER_MCP_AUTH_CONTINUE };
    await submitTurnEvent({
      event,
      submissionId: 'mcp-auth-continue',
      optimisticSnapshot: snapshotRef.current,
    });
  }, [submitTurnEvent]);

  const resumeRun = useCallback(async () => {
    const turn = activeTurnRef.current;
    if (turn == null) {
      return;
    }
    const active = snapshotRef.current.activeStream;
    await runStream(
      signal =>
        resumeTurnStream(
          server,
          turn.sessionId,
          turn.id,
          snapshotRef.current.fold,
          signal,
          active?.turnId === turn.id ? active.lastSequenceNumber : undefined,
          snapshotRef.current.groupRootBaseline,
        ),
      { current: turn.id },
      {
        initiallyRunning: turn.state.status === TURN_STATUS.RUNNING,
        transport: 'subscribe',
      },
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
    continueMcpAuth,
    resumeRun,
    branchFromTurn,
    resetFromTurn,
    editFromTurn,
  };
}

export { findPausedAssistantMessage };
