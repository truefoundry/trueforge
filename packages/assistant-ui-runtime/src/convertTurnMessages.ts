import type {
  AppendMessage,
  CompleteAttachment,
  ExportedMessageRepositoryItem,
  MessageStatus,
  ThreadMessage,
  ThreadUserMessagePart,
} from '@assistant-ui/core';
import {
  ASSISTANT_MESSAGE_STATUS_REASON,
  ASSISTANT_MESSAGE_STATUS_TYPE,
  completeAssistantStatus,
  runningAssistantStatus,
  toolCallsRequiredAssistantStatus,
} from './assistantMessageStatus.js';
import type {
  McpAuthRequiredEvent,
  PersistedTurnEvent,
  SessionEventItem,
  Turn,
  TurnCreatedEvent,
  TurnEvent,
  TurnInputItem,
  TurnStreamData,
  TurnUpdateEvent,
  UserMessageContent,
} from './server/index.js';
import { EVENT_TYPE, TURN_STATUS } from './server/index.js';
import type { AgentChatServer } from './server/types.js';

import { ROOT_THREAD_ID } from './constants.js';
import { extractTurnUserText } from './extractTurnUserText.js';
import {
  buildRootAssistantContent,
  buildRootAssistantContentForIds,
  findFirstPendingApprovalThreadId,
  findFirstPendingResponseThreadId,
  ingestStreamEvent,
  ingestTurnEvent,
  PeerThreadFoldState,
  type ThreadBucket,
} from './foldPeerThreads.js';
import { drainListPages } from './listPages.js';
import { buildMcpAuthTextParts, mcpAuthAssistantStatus, mcpAuthMessageCustom } from './mcpAuth.js';
import { MESSAGE_CUSTOM_KEY } from './messageCustomMetadata.js';
import type { AssistantContentPart } from './modelMessageContent.js';
import { extractImageUrlFromUserContentItem, imageUrlToAttachment } from './modelMessageImageContent.js';
import {
  createEmptySessionSnapshot,
  replaceSessionSnapshot,
  sessionEventsToSessionRecord,
  STREAM_SEGMENT_STATUS,
  turnToSessionRecord,
  type ProjectSessionMessagesOptions,
  type RequiredActionsOverlay,
  type SessionHistoryPagination,
  type SessionSnapshot,
  type SessionTurnRecord,
} from './sessionSnapshot.js';
import {
  applyApprovalDecisionsToContent,
  collectApprovalDecisionsFromTurnInput,
  collectSubsequentApprovalDecisions,
  messageHasPendingApprovals,
  toolApprovalMessageCustom,
  toolApprovalStatus,
} from './toolApproval.js';
import {
  applyStagedResponsesToContent,
  applyUserToolResponsesToFold,
  collectSubsequentToolResponses,
  collectToolResponsesFromTurnInput,
  messageHasPendingResponses,
  toolResponseMessageCustom,
  toolResponseStatus,
} from './toolResponse.js';
import { appendMcpAuthToTurnContent, appendToolApprovalToTurnContent } from './turnEventHelpers.js';
import type { TurnStreamUpdate } from './turnStreamUpdate.js';

const MESSAGE_ID_SUFFIX = {
  ASSISTANT: '-assistant',
  USER: '-user',
} as const;

/**
 * Turn / event → assistant-ui normalization
 *
 * This module is the projection layer: it turns gateway session state into
 * `ThreadMessage[]` for `@assistant-ui/core`. The hook in
 * `useTrueForgeAgentMessages.ts` owns the mutable `SessionSnapshot`; this
 * file defines how that snapshot is built and rendered.
 *
 * ## Data model
 *
 * Gateway side:
 * - A **session** has ordered **turns** (each with `input`, `state`, `listEvents`).
 * - A turn's **input** is either a user message (`user.message`) or a continuation
 *   (`user.tool_response`, `user.tool_approval`, …).
 * - **Events** (`model.message`, `tool.*`, `thread.created`, …) arrive on a
 *   **thread id**; the root conversation uses `ROOT_THREAD_ID` (`"main"`).
 *
 * Local side (`SessionSnapshot` in `sessionSnapshot.ts`):
 * - `fold` — accumulated events across all threads (see `foldPeerThreads.ts`).
 * - `turns` — committed turn records, each optionally storing
 *   `rootModelMessageIds` (root-thread `model.message` ids ingested with that turn).
 * - `pendingUser` / `activeStream` — optimistic UI while a turn is in flight.
 * - `groupRootBaseline` — root `model.message` ids that existed before the active
 *   turn group started; used to scope live streaming to the current group only.
 * - `requiredActions` — optimistic approval/response decisions awaiting server acknowledgement.
 *
 * Output:
 * - Alternating **user** / **assistant** `ThreadMessage` pairs.
 * - One assistant message per logical user turn, across all of its stream segments.
 *
 * ## Turn groups
 *
 * New sessions keep required actions on the original turn. The grouping logic
 * remains only to render historical sessions that stored approvals and tool
 * responses as separate continuation turns.
 *
 * Root content for a group is the union of `rootModelMessageIds` on every turn
 * in that group. Prior groups must not leak in: scope with
 * `rootModelMessageIdsSinceBaseline(fold, baseline)` where
 * `baseline = groupRootBaseline ?? computeGroupRootBaseline(turns)`.
 *
 * ## Pipeline
 *
 * 1. **Ingest** — `ingestStreamEvent` / `ingestTurnEvent` append events into
 *    per-thread buckets in `PeerThreadFoldState`. Deltas merge in place.
 *
 * 2. **Fold to content** — `buildRootAssistantContentForIds` walks scoped
 *    `model.message` ids and emits assistant-ui parts (reasoning, text, tool-call).
 *    Sub-agent child threads are attached under `create_sub_agent` tool-calls as
 *    nested `messages` (see `attachSubAgentMessages` in `foldPeerThreads.ts`).
 *
 * 3. **History projection** — `projectHistoryTurns` walks committed `turns`:
 *    - User turn → push user message; push assistant if the group has content.
 *    - Legacy continuation turn → merge assistant content into the prior message.
 *    - Apply answers from later continuation turns onto earlier tool-calls via
 *      `collectSubsequentApprovalDecisions` / `collectSubsequentToolResponses`.
 *    - A paused group's assistant message keeps `requires-action` until a later
 *      continuation turn resolves all its approvals/responses, then downgrades
 *      to the turn-state status (`complete`, `error`, `cancelled`).
 *
 * 4. **Live projection** — `projectSessionMessages` = history + `pendingUser` +
 *    `activeStream`. While streaming, `streamTurnEvents` yields content scoped to
 *    `groupRootBaseline`. When a segment pauses or disconnects,
 *    `projectActiveStreamUpdate` rebuilds from the fold without completing the
 *    logical turn.
 *
 * 5. **Staged overlay** — While an inbound event is being acknowledged, user
 *    decisions sit in `requiredActions` and are merged onto messages by
 *    `applyRequiredActionsOverlayToMessages` so the UI shows interrupt + result
 *    together. Each action is sent immediately; only `turn.update: running`
 *    confirms that every required action has been resolved.
 *
 * ## Required actions (assistant-ui mapping)
 *
 * | Gateway event / input        | assistant-ui representation                          |
 * |-----------------------------|------------------------------------------------------|
 * | `tool.approval_required`    | `tool-call` with `approval: { id }`, status          |
 * |                             | `requires-action` / `tool-calls`, custom thread id   |
 * | `user.tool_approval`        | closes `tool.approval_required`: sets `approval.approved` |
 * |                             | (+ optional reason) on tool-call                       |
 * | `tool.response_required`    | `tool-call` with `interrupt: { type: "human", … }`   |
 * | (ask_user_question)         | payload parsed from tool args (`askUserQuestion.ts`)   |
 * | `user.tool_response`        | closes `tool.response_required`: sets `result` on      |
 * |                             | tool-call and clears the pending `interrupt`           |
 * | `mcp.auth_required`         | Appended auth link text parts; status `interrupt`     |
 * | `user.mcp_auth_continue`    | Confirms browser auth; server decides when to run     |
 *
 * Sub-agent threads can have their own pending approval/response; metadata
 * `toolApprovalThreadId` / `toolResponseThreadId` on nested assistant messages
 * scopes inbound events to the correct thread.
 *
 * A sub-agent stays attached under the `create_sub_agent` tool-call that spawned
 * it. Paused and resumed stream segments keep appending to that same turn and
 * render under the same tool-call.
 *
 * INVARIANT — while a sub-agent is active the parent agent is paused awaiting a
 * required action. Responses are events on that turn, not a new `user.message`
 * turn; otherwise the active child would be split away from its tool-call.
 *
 * ## Assumptions
 *
 * - Root-thread model messages use `threadId === ROOT_THREAD_ID`.
 * - Turn order in `snapshot.turns` matches gateway chronological order.
 * - `rootModelMessageIds` on committed turns is accurate (set only after `turn.done`).
 * - Legacy continuation turns never carry `user.message`; that boundary exists
 *   only for backward-compatible history projection.
 * - Tool-call identity is stable via `toolCallId` across events, fold state, and
 *   assistant-ui parts.
 * - Reload (`buildSnapshotFromSessionEvents`) and live paths must produce the same
 *   per-group scoping; history uses cumulative `groupRootIds` per turn index,
 *   live uses `groupRootBaseline`.
 */

const TURN_EVENTS_PAGE_SIZE = 25;
const SESSION_EVENTS_PAGE_SIZE = 100;
/** Cap how many event pages initial load / load-older may chain for a group boundary. */
const MAX_HISTORY_BOUNDARY_PAGES = 10;

interface FetchSessionEventsOptions {
  /**
   * Newest turn in the listing window (initial load only). Lists that turn and
   * its ancestors. Omit to use the session last turn. Running-turn events are
   * excluded by the API — subscribe to that turn for live events.
   */
  lastTurnId?: string;
}

interface SessionEventsPageResult {
  /** Newest-first items from this request. */
  itemsNewestFirst: SessionEventItem[];
  olderPageToken?: string;
  hasOlder: boolean;
}

/**
 * Drops a leading incomplete turn (events before the first `turn.created`) that
 * appears when a page boundary splits a turn.
 */
function trimIncompleteLeadingEvents(itemsAsc: SessionEventItem[]): SessionEventItem[] {
  const start = itemsAsc.findIndex(item => item.event.type === EVENT_TYPE.TURN_CREATED);
  if (start === -1) {
    return [];
  }
  return itemsAsc.slice(start);
}

/**
 * Whether the oldest complete turn in a chronological window opens a user group.
 * `incomplete` means we still lack a finished oldest turn (need an older page).
 */
function oldestCompleteTurnGroupState(itemsAsc: SessionEventItem[]): 'user-group' | 'continuation' | 'incomplete' {
  const trimmed = trimIncompleteLeadingEvents(itemsAsc);
  if (trimmed.length === 0) {
    return 'incomplete';
  }
  const created = trimmed[0];
  if (created?.event.type !== EVENT_TYPE.TURN_CREATED) {
    return 'incomplete';
  }
  const hasDone = trimmed.some(item => item.turnId === created.turnId && item.event.type === EVENT_TYPE.TURN_DONE);
  if (!hasDone) {
    return 'incomplete';
  }
  return extractTurnUserText(created.event.input) != null ? 'user-group' : 'continuation';
}

async function fetchSessionEventsPage(
  server: AgentChatServer,
  sessionId: string,
  options?: FetchSessionEventsOptions & { pageToken?: string },
): Promise<SessionEventsPageResult> {
  const page = await server.listEvents({
    sessionId,
    limit: SESSION_EVENTS_PAGE_SIZE,
    ...(options?.lastTurnId != null ? { lastTurnId: options.lastTurnId } : {}),
    ...(options?.pageToken != null ? { pageToken: options.pageToken } : {}),
  });
  const olderPageToken = page.nextPageToken;
  const hasOlder = olderPageToken != null && olderPageToken !== '';
  return {
    itemsNewestFirst: page.data,
    ...(olderPageToken != null && olderPageToken !== '' ? { olderPageToken } : {}),
    hasOlder,
  };
}

/**
 * Fetches pages until the chronological window starts on a complete user-message
 * turn group (or history is exhausted).
 */
async function fetchSessionEventsWindow(
  server: AgentChatServer,
  sessionId: string,
  options?: FetchSessionEventsOptions & { pageToken?: string },
): Promise<{
  itemsAsc: SessionEventItem[];
  olderPageToken?: string;
  hasOlder: boolean;
}> {
  let itemsNewestFirst: SessionEventItem[] = [];
  let pageToken = options?.pageToken;
  let olderPageToken: string | undefined;
  let hasOlder = false;

  for (let pageCount = 0; pageCount < MAX_HISTORY_BOUNDARY_PAGES; pageCount++) {
    const page = await fetchSessionEventsPage(server, sessionId, {
      ...options,
      ...(pageToken != null ? { pageToken } : {}),
    });
    itemsNewestFirst = [...itemsNewestFirst, ...page.itemsNewestFirst];
    olderPageToken = page.olderPageToken;
    hasOlder = page.hasOlder;

    const itemsAsc = trimIncompleteLeadingEvents([...itemsNewestFirst].reverse());
    const groupState = oldestCompleteTurnGroupState(itemsAsc);
    if (groupState === 'user-group' || !hasOlder) {
      return {
        itemsAsc,
        ...(olderPageToken != null ? { olderPageToken } : {}),
        hasOlder,
      };
    }

    if (olderPageToken == null) {
      return { itemsAsc, hasOlder: false };
    }
    pageToken = olderPageToken;
  }

  const itemsAsc = trimIncompleteLeadingEvents([...itemsNewestFirst].reverse());
  return {
    itemsAsc,
    ...(olderPageToken != null ? { olderPageToken } : {}),
    hasOlder,
  };
}

/**
 * Fetches session-level events via `server.listEvents()`. The API returns pages
 * in desc order (newest first); the collected array is reversed before returning
 * so callers receive events in chronological (asc) order.
 *
 * Used by rewind/edit paths that need the full ancestor window.
 */
async function fetchAllSessionEvents(
  server: AgentChatServer,
  sessionId: string,
  options?: FetchSessionEventsOptions,
): Promise<SessionEventItem[]> {
  const items = await drainListPages(pageToken =>
    server.listEvents({
      sessionId,
      limit: SESSION_EVENTS_PAGE_SIZE,
      ...(options?.lastTurnId != null ? { lastTurnId: options.lastTurnId } : {}),
      ...(pageToken != null ? { pageToken } : {}),
    }),
  );
  items.reverse();
  return items;
}

function cloneThreadBucket(bucket: ThreadBucket): ThreadBucket {
  return {
    events: new Map(bucket.events),
    modelMessageIds: [...bucket.modelMessageIds],
    toolResults: new Map(bucket.toolResults),
    pendingApprovals: new Map(bucket.pendingApprovals),
    approvalDecisions: new Map(bucket.approvalDecisions),
    pendingResponses: new Map(bucket.pendingResponses),
    done: bucket.done,
    ...(bucket.title != null ? { title: bucket.title } : {}),
    ...(bucket.agentInfo != null ? { agentInfo: bucket.agentInfo } : {}),
  };
}

/** Prepends older fold state ahead of the currently loaded fold (scroll-up). */
export function prependFoldState(older: PeerThreadFoldState, newer: PeerThreadFoldState): PeerThreadFoldState {
  const result = new PeerThreadFoldState();
  const threadIds = new Set([...older.threads.keys(), ...newer.threads.keys()]);
  for (const threadId of threadIds) {
    const olderBucket = older.threads.get(threadId);
    const newerBucket = newer.threads.get(threadId);
    if (olderBucket == null && newerBucket != null) {
      result.threads.set(threadId, cloneThreadBucket(newerBucket));
      continue;
    }
    if (newerBucket == null && olderBucket != null) {
      result.threads.set(threadId, cloneThreadBucket(olderBucket));
      continue;
    }
    if (olderBucket == null || newerBucket == null) {
      continue;
    }
    result.threads.set(threadId, {
      events: new Map([...olderBucket.events, ...newerBucket.events]),
      modelMessageIds: [...olderBucket.modelMessageIds, ...newerBucket.modelMessageIds],
      toolResults: new Map([...olderBucket.toolResults, ...newerBucket.toolResults]),
      pendingApprovals: new Map([...olderBucket.pendingApprovals, ...newerBucket.pendingApprovals]),
      approvalDecisions: new Map([...olderBucket.approvalDecisions, ...newerBucket.approvalDecisions]),
      pendingResponses: new Map([...olderBucket.pendingResponses, ...newerBucket.pendingResponses]),
      done: newerBucket.done || olderBucket.done,
      ...(newerBucket.title != null || olderBucket.title != null
        ? { title: newerBucket.title ?? olderBucket.title }
        : {}),
      ...(newerBucket.agentInfo != null || olderBucket.agentInfo != null
        ? { agentInfo: newerBucket.agentInfo ?? olderBucket.agentInfo }
        : {}),
    });
  }
  for (const [threadId, link] of older.threadParents) {
    result.threadParents.set(threadId, link);
  }
  for (const [threadId, link] of newer.threadParents) {
    result.threadParents.set(threadId, link);
  }
  return result;
}

/**
 * Ingests a chronologically ordered list of session-level event items into the
 * snapshot. `turn.created` marks the start of a turn (provides user input),
 * content events are folded as usual, and `turn.done` finalises the turn record
 * and pushes it to `snapshot.turns`.
 *
 * `onTurnComplete` is called after each `turn.done` with the partially-built
 * snapshot so callers can update UI progressively. The fold state is correct at
 * that point for every turn up to and including the just-completed one.
 */
function ingestSessionEventsIntoSnapshot(
  snapshot: SessionSnapshot,
  items: SessionEventItem[],
  onTurnComplete?: (snap: SessionSnapshot) => void,
): void {
  let currentTurnId: string | null = null;
  let currentCreatedEvent: TurnCreatedEvent | null = null;
  let currentContentEvents: TurnEvent[] = [];
  let beforeCount = 0;
  // Session-scoped: sandbox.created fires when a sandbox is (re)created and the
  // sandbox is reused by later turns, so carry the latest one forward.
  let sessionSandboxId: string | undefined;

  for (const item of items) {
    const { turnId, event } = item;

    if (event.type === EVENT_TYPE.TURN_CREATED) {
      currentTurnId = turnId;
      currentCreatedEvent = event;
      currentContentEvents = [];
      beforeCount = snapshot.fold.threads.get(ROOT_THREAD_ID)?.modelMessageIds.length ?? 0;
    } else if (event.type === EVENT_TYPE.TURN_DONE) {
      if (currentTurnId == null || currentCreatedEvent == null) {
        continue;
      }

      const afterBucket = snapshot.fold.threads.get(ROOT_THREAD_ID);
      const rootModelMessageIds = (afterBucket?.modelMessageIds ?? []).slice(beforeCount);

      const sandboxEvent = currentContentEvents.find(
        (ev): ev is Extract<TurnEvent, { type: typeof EVENT_TYPE.SANDBOX_CREATED }> =>
          ev.type === EVENT_TYPE.SANDBOX_CREATED,
      );
      sessionSandboxId = sandboxEvent?.sandboxId ?? sessionSandboxId;

      applyUserToolResponsesToFold(snapshot.fold, currentCreatedEvent.input ?? []);
      snapshot.turns.push(
        sessionEventsToSessionRecord(currentTurnId, currentCreatedEvent, event, rootModelMessageIds, sessionSandboxId),
      );
      snapshot.pendingMcpAuth = undefined;

      // Pass a new object reference so React's Object.is check in
      // useState sees a changed value and schedules a re-render.
      // The snapshot is mutated in place throughout this loop, so
      // passing `snapshot` directly would make every tick look identical
      // to React after the first setSnapshot call.
      onTurnComplete?.(replaceSessionSnapshot(snapshot, {}));

      currentTurnId = null;
      currentCreatedEvent = null;
      currentContentEvents = [];
    } else if (event.type === EVENT_TYPE.TURN_UPDATE) {
      // Lifecycle updates describe the open turn but do not belong in a thread
      // bucket. resolveSessionTip reads the latest update below.
      if (event.state.status === TURN_STATUS.RUNNING) {
        snapshot.pendingMcpAuth = undefined;
      }
      continue;
    } else {
      if (currentTurnId != null) {
        if (event.type === EVENT_TYPE.MCP_AUTH_REQUIRED) {
          snapshot.pendingMcpAuth = event;
        } else if (event.type === EVENT_TYPE.USER_MCP_AUTH_CONTINUE) {
          snapshot.pendingMcpAuth = undefined;
        }
        ingestTurnEvent(snapshot.fold, event);
        currentContentEvents.push(event);
      }
    }
  }
}

function attachActiveTurn(
  snapshot: SessionSnapshot,
  activeTurn: Turn | undefined,
  sandboxId?: string,
): SessionSnapshot {
  if (activeTurn == null) {
    return snapshot;
  }
  const pendingUserText = extractTurnUserText(activeTurn.input);
  const groupRootBaseline = computeGroupRootBaseline(snapshot.turns);
  const rootModelMessageIds = rootModelMessageIdsSinceBaseline(snapshot.fold, groupRootBaseline);
  const activeUpdate = buildTurnUpdateFromFold(
    snapshot.fold,
    {
      state: activeTurn.state,
      pendingMcpAuth: snapshot.pendingMcpAuth,
    },
    rootModelMessageIds,
  );
  const shouldProjectActiveStream = activeTurn.state.status === TURN_STATUS.PAUSED || activeUpdate.content.length > 0;
  return replaceSessionSnapshot(snapshot, {
    activeTurn,
    unstable_resume: true,
    groupRootBaseline,
    ...(shouldProjectActiveStream
      ? {
          activeStream: {
            turnId: activeTurn.id,
            update: {
              ...activeUpdate,
              turnState: activeTurn.state,
              ...(sandboxId != null
                ? {
                    metadata: {
                      ...activeUpdate.metadata,
                      custom: {
                        ...activeUpdate.metadata?.custom,
                        [MESSAGE_CUSTOM_KEY.SANDBOX_ID]: sandboxId,
                      },
                    },
                  }
                : {}),
            },
            segmentStatus:
              activeTurn.state.status === TURN_STATUS.PAUSED
                ? STREAM_SEGMENT_STATUS.PAUSED
                : STREAM_SEGMENT_STATUS.DISCONNECTED,
          },
        }
      : {}),
    ...(pendingUserText !== undefined
      ? {
          pendingUser: {
            turnId: activeTurn.id,
            content: extractTurnUserMessageContent(activeTurn.input),
            createdAt: new Date(activeTurn.createdAt),
          },
        }
      : {}),
  });
}

/**
 * Last `turn.created` in ASC event order with no following `turn.done` — the
 * open tip of the active branch in this window.
 */
function findOpenTurnCreated(
  itemsAsc: readonly SessionEventItem[],
): { turnId: string; event: TurnCreatedEvent; update?: TurnUpdateEvent; sandboxId?: string } | undefined {
  let open: { turnId: string; event: TurnCreatedEvent; update?: TurnUpdateEvent; sandboxId?: string } | undefined;
  for (const item of itemsAsc) {
    if (item.event.type === EVENT_TYPE.TURN_CREATED) {
      open = { turnId: item.turnId, event: item.event };
    } else if (item.event.type === EVENT_TYPE.TURN_UPDATE && open?.turnId === item.turnId) {
      open = { ...open, update: item.event };
    } else if (item.event.type === EVENT_TYPE.SANDBOX_CREATED && open?.turnId === item.turnId) {
      open = { ...open, sandboxId: item.event.sandboxId };
    } else if (item.event.type === EVENT_TYPE.TURN_DONE) {
      open = undefined;
    }
  }
  return open;
}

function turnFromCreatedEvent(options: {
  sessionId: string;
  turnId: string;
  event: TurnCreatedEvent;
  update?: TurnUpdateEvent;
}): Turn {
  const { sessionId, turnId, event, update } = options;
  return {
    id: turnId,
    sessionId,
    state:
      update?.state.status === TURN_STATUS.PAUSED
        ? {
            status: TURN_STATUS.PAUSED,
            actionRequiredOnEvents: update.state.actionRequiredOnEvents,
            pausedAt: update.state.pausedAt,
            ...(update.state.expiresAt != null ? { expiresAt: update.state.expiresAt } : {}),
          }
        : { status: TURN_STATUS.RUNNING },
    createdAt: event.createdAt,
    ...(event.input != null ? { input: event.input } : {}),
    ...(event.previousTurnId === undefined ? {} : { previousTurnId: event.previousTurnId }),
  };
}

interface SessionTip {
  /** Non-terminal turn to subscribe to; absent once the tip has finished. */
  activeTurn?: Turn;
  sandboxId?: string;
  /**
   * Tip input that event ingestion could not apply, because it only folds a
   * turn's input once that turn's `turn.done` arrives. Answered ask-user
   * prompts and approvals live here, so this must be folded even when the tip
   * is no longer running.
   */
  continuationInput: readonly TurnInputItem[];
}

/**
 * Resolves the tip turn of the active branch for resume/subscribe.
 *
 * Prefer an open tip from the events window (works when listTurns is
 * oldest-first and when listEvents includes the running turn). Fall back to
 * `listTurns({ limit: 1 })` for hosts that omit the running turn from
 * listEvents and put the tip first.
 */
async function resolveSessionTip(options: {
  server: AgentChatServer;
  sessionId: string;
  itemsAsc: readonly SessionEventItem[];
}): Promise<SessionTip> {
  const { server, sessionId, itemsAsc } = options;
  const open = findOpenTurnCreated(itemsAsc);
  if (open != null) {
    const continuationInput = open.event.input ?? [];
    if (typeof server.getTurn === 'function') {
      try {
        const turn = await server.getTurn({
          sessionId,
          turnId: open.turnId,
        });
        if (turn.state.status === TURN_STATUS.RUNNING || turn.state.status === TURN_STATUS.PAUSED) {
          return {
            activeTurn:
              open.update?.state.status === TURN_STATUS.PAUSED && turn.state.status === TURN_STATUS.RUNNING
                ? turnFromCreatedEvent({
                    sessionId,
                    turnId: open.turnId,
                    event: open.event,
                    update: open.update,
                  })
                : turn,
            ...(open.sandboxId != null ? { sandboxId: open.sandboxId } : {}),
            continuationInput: turn.input ?? continuationInput,
          };
        }
        // Tip finished between listEvents and getTurn: nothing to
        // resume, but its answers still belong in the fold.
        return { continuationInput: turn.input ?? continuationInput };
      } catch {
        // getTurn failed; synthesize from the open turn.created below.
      }
    }
    return {
      activeTurn: turnFromCreatedEvent({
        sessionId,
        turnId: open.turnId,
        event: open.event,
        ...(open.update != null ? { update: open.update } : {}),
      }),
      ...(open.sandboxId != null ? { sandboxId: open.sandboxId } : {}),
      continuationInput,
    };
  }

  // Hosts that exclude the running turn from listEvents still surface it as
  // the first row of listTurns when that API is tip-first.
  const turnsPage = await server.listTurns({ sessionId, limit: 1 });
  const tip = turnsPage.data[0];
  return tip?.state.status === TURN_STATUS.RUNNING || tip?.state.status === TURN_STATUS.PAUSED
    ? { activeTurn: tip, continuationInput: tip.input ?? [] }
    : { continuationInput: [] };
}

/**
 * Builds a session snapshot using the session-level `listEvents` API.
 *
 * Loads the newest event page (extending only when a page boundary splits a
 * turn group), then leaves older pages for `prependOlderSessionHistory`.
 * Detects a currently-running tip from an open `turn.created` in that window
 * when present; otherwise falls back to `listTurns({ limit: 1 })` for hosts
 * that omit the running turn from listEvents.
 *
 * `onProgress` is called after each complete turn is ingested so callers can
 * update the UI progressively while the processing loop runs.
 */
export async function buildSnapshotFromSessionEvents(
  server: AgentChatServer,
  sessionId: string,
  onProgress?: (snap: SessionSnapshot) => void,
): Promise<SessionSnapshot> {
  const window = await fetchSessionEventsWindow(server, sessionId);
  const historyPagination: SessionHistoryPagination = {
    hasOlder: window.hasOlder,
    ...(window.olderPageToken != null ? { olderPageToken: window.olderPageToken } : {}),
  };

  const snapshot = createEmptySessionSnapshot();
  ingestSessionEventsIntoSnapshot(snapshot, window.itemsAsc, onProgress);

  const withHistory = replaceSessionSnapshot(snapshot, {
    historyEvents: window.itemsAsc,
    historyPagination,
  });

  const tip = await resolveSessionTip({
    server,
    sessionId,
    itemsAsc: window.itemsAsc,
  });
  // The tip has no turn.done in this window, so ingestion never folded its
  // input. Apply it here so answered approvals / ask-user prompts are not
  // restored as pending after a refresh.
  applyUserToolResponsesToFold(withHistory.fold, tip.continuationInput);
  return attachActiveTurn(withHistory, tip.activeTurn, tip.sandboxId);
}

/**
 * Fetches the next older `listEvents` window and prepends it onto `snapshot`
 * without tearing down live stream / pending UI state.
 */
export async function prependOlderSessionHistory(
  server: AgentChatServer,
  sessionId: string,
  snapshot: SessionSnapshot,
): Promise<SessionSnapshot> {
  const pagination = snapshot.historyPagination;
  if (pagination?.hasOlder !== true || pagination.olderPageToken == null) {
    return snapshot;
  }

  const window = await fetchSessionEventsWindow(server, sessionId, {
    pageToken: pagination.olderPageToken,
  });
  if (window.itemsAsc.length === 0) {
    return replaceSessionSnapshot(snapshot, {
      historyPagination: { hasOlder: false },
    });
  }

  const olderSnap = createEmptySessionSnapshot();
  ingestSessionEventsIntoSnapshot(olderSnap, window.itemsAsc);

  const existingIds = new Set(snapshot.turns.map(turn => turn.id));
  const olderTurns = olderSnap.turns.filter(turn => !existingIds.has(turn.id));
  const mergedFold = prependFoldState(olderSnap.fold, snapshot.fold);
  const historyEvents = [...window.itemsAsc, ...(snapshot.historyEvents ?? [])];
  const olderRootIds = olderTurns.flatMap(turn => turn.rootModelMessageIds ?? []);

  // Forward-propagate sandbox identity revealed by older pages onto
  // already-loaded newer turns that reused the sandbox without emitting
  // sandbox.created. A turn's own sandboxId (a mid-session re-create) wins.
  let knownSandboxId: string | undefined;
  const mergedTurns = [...olderTurns, ...snapshot.turns].map(turn => {
    if (turn.sandboxId != null) {
      knownSandboxId = turn.sandboxId;
      return turn;
    }
    if (knownSandboxId != null) {
      return { ...turn, sandboxId: knownSandboxId };
    }
    return turn;
  });

  return replaceSessionSnapshot(snapshot, {
    fold: mergedFold,
    turns: mergedTurns,
    historyEvents,
    historyPagination: {
      hasOlder: window.hasOlder,
      ...(window.olderPageToken != null ? { olderPageToken: window.olderPageToken } : {}),
    },
    ...(snapshot.groupRootBaseline != null
      ? {
          groupRootBaseline: [...olderRootIds, ...snapshot.groupRootBaseline],
        }
      : {}),
  });
}

export interface ConvertTurnsResult {
  messages: ThreadMessage[];
  foldState: PeerThreadFoldState;
  activeTurn?: Turn;
  unstable_resume?: boolean;
}

function assistantStatusFromTurnState(state: Turn['state']): MessageStatus {
  switch (state.status) {
    case TURN_STATUS.DONE:
      return completeAssistantStatus();
    case TURN_STATUS.ERROR:
      return {
        type: ASSISTANT_MESSAGE_STATUS_TYPE.INCOMPLETE,
        reason: ASSISTANT_MESSAGE_STATUS_REASON.ERROR,
        error: state.message,
      };
    case TURN_STATUS.CANCELLED:
      return {
        type: ASSISTANT_MESSAGE_STATUS_TYPE.INCOMPLETE,
        reason: ASSISTANT_MESSAGE_STATUS_REASON.CANCELLED,
      };
    case TURN_STATUS.RUNNING:
      return runningAssistantStatus();
    case TURN_STATUS.PAUSED:
      return toolCallsRequiredAssistantStatus();
  }
}

function resolveCreatedAt(
  messageId: string,
  fallback: Date,
  options?: ProjectSessionMessagesOptions,
  replace = false,
): Date {
  return options?.getCreatedAt?.(messageId, fallback, replace) ?? fallback;
}

function parseDataUriMime(data: string): string {
  if (!data.startsWith('data:')) {
    return 'application/octet-stream';
  }
  const match = /^data:([^;,]+)/.exec(data);
  return match?.[1] ?? 'application/octet-stream';
}

function fileContentToAttachment(file: FileContent, attachmentId: string): CompleteAttachment {
  const mimeType = parseDataUriMime(file.data);
  if (mimeType.startsWith('image/')) {
    return {
      id: attachmentId,
      type: 'image',
      name: file.name,
      contentType: mimeType,
      status: { type: 'complete' },
      content: [{ type: 'image', image: file.data, filename: file.name }],
    };
  }
  return {
    id: attachmentId,
    type: 'file',
    name: file.name,
    contentType: mimeType,
    status: { type: 'complete' },
    content: [
      {
        type: 'file',
        mimeType,
        filename: file.name,
        data: file.data,
      },
    ],
  };
}

/** Projects gateway turn input onto an assistant-ui user message (text + attachments). */
export function buildUserMessageFromTurnInput(
  turnId: string,
  input: Turn['input'],
  createdAt: string | Date,
  options?: ProjectSessionMessagesOptions,
): ThreadMessage {
  const fallback = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const id = `${turnId}${MESSAGE_ID_SUFFIX.USER}`;
  const content: ThreadUserMessagePart[] = [];
  const attachments: CompleteAttachment[] = [];

  for (const item of input ?? []) {
    if (item.type !== EVENT_TYPE.USER_MESSAGE) {
      continue;
    }
    const messageContent = item.content;
    if (typeof messageContent === 'string') {
      content.push({ type: 'text', text: messageContent });
      continue;
    }
    for (const part of messageContent) {
      const imageUrl = extractImageUrlFromUserContentItem(part);
      if (imageUrl != null) {
        attachments.push(imageUrlToAttachment(imageUrl, `${turnId}-file-${String(attachments.length)}`));
        continue;
      }
      if (part.type === 'text') {
        content.push({ type: 'text', text: part.text });
      } else {
        attachments.push(fileContentToAttachment(part, `${turnId}-file-${String(attachments.length)}`));
      }
    }
  }

  return {
    id,
    role: 'user',
    content: content.length > 0 ? content : [{ type: 'text', text: '' }],
    attachments,
    createdAt: resolveCreatedAt(id, fallback, options),
    metadata: { custom: {} },
  };
}

function buildAssistantMessage(
  turnId: string,
  content: AssistantContentPart[],
  createdAt: string | Date,
  status: MessageStatus,
  custom: Record<string, unknown> = {},
  options?: ProjectSessionMessagesOptions,
  replaceCreatedAt = false,
): ThreadMessage {
  const fallback = createdAt instanceof Date ? createdAt : new Date(createdAt);
  const id = `${turnId}${MESSAGE_ID_SUFFIX.ASSISTANT}`;
  return {
    id,
    role: 'assistant',
    content,
    status,
    createdAt: resolveCreatedAt(id, fallback, options, replaceCreatedAt),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom,
    },
  };
}

async function ingestTurnEventsIntoFold(
  server: AgentChatServer,
  sessionId: string,
  turnId: string,
  foldState: PeerThreadFoldState,
): Promise<void> {
  if (server.listTurnEvents == null) {
    return;
  }
  const listTurnEvents = server.listTurnEvents.bind(server);
  const events = await drainListPages(pageToken =>
    listTurnEvents({
      sessionId,
      turnId,
      order: 'asc',
      limit: TURN_EVENTS_PAGE_SIZE,
      ...(pageToken != null ? { pageToken } : {}),
    }),
  );
  ingestCollectedEventsIntoFold(foldState, events);
}

async function fetchTurnEvents(
  server: AgentChatServer,
  sessionId: string,
  turnId: string,
): Promise<PersistedTurnEvent[]> {
  if (server.listTurnEvents == null) {
    return [];
  }
  const listTurnEvents = server.listTurnEvents.bind(server);
  const events = await drainListPages(pageToken =>
    listTurnEvents({
      sessionId,
      turnId,
      order: 'asc',
      limit: TURN_EVENTS_PAGE_SIZE,
      ...(pageToken != null ? { pageToken } : {}),
    }),
  );
  return events;
}

function ingestCollectedEventsIntoFold(foldState: PeerThreadFoldState, events: PersistedTurnEvent[]): void {
  for (const event of events) {
    if (
      event.type === EVENT_TYPE.TURN_CREATED ||
      event.type === EVENT_TYPE.TURN_UPDATE ||
      event.type === EVENT_TYPE.TURN_DONE
    ) {
      continue;
    }
    ingestTurnEvent(foldState, event);
  }
}

async function fetchAllTurnEventsWithConcurrency(
  server: AgentChatServer,
  sessionId: string,
  turns: Turn[],
  concurrency: number,
): Promise<PersistedTurnEvent[][]> {
  const results = Array.from({ length: turns.length }, (): PersistedTurnEvent[] => []);
  const pool = new Set<Promise<void>>();
  for (let i = 0; i < turns.length; i++) {
    const idx = i;
    const turn = turns[idx];
    if (turn == null) {
      continue;
    }
    const p: Promise<void> = fetchTurnEvents(server, sessionId, turn.id).then(events => {
      results[idx] = events;
      pool.delete(p);
    });
    pool.add(p);
    if (pool.size >= concurrency) {
      await Promise.race(pool);
    }
  }
  await Promise.all(pool);
  return results;
}

export function rootModelMessageIdsSinceBaseline(
  foldState: PeerThreadFoldState,
  baseline: readonly string[],
): string[] {
  const bucket = foldState.threads.get(ROOT_THREAD_ID);
  if (bucket == null) {
    return [];
  }
  if (baseline.length === 0) {
    return [...bucket.modelMessageIds];
  }
  const baselineSet = new Set(baseline);
  return bucket.modelMessageIds.filter(id => !baselineSet.has(id));
}

export function computeGroupRootBaseline(turns: SessionTurnRecord[]): string[] {
  let groupStartIndex = turns.length - 1;
  while (groupStartIndex >= 0 && turns[groupStartIndex]?.userText == null) {
    groupStartIndex--;
  }
  const baseline: string[] = [];
  for (let i = 0; i < groupStartIndex; i++) {
    baseline.push(...(turns[i]?.rootModelMessageIds ?? []));
  }
  return baseline;
}

function buildTurnUpdateFromFold(
  foldState: PeerThreadFoldState,
  turn: Pick<Turn, 'state'> & { pendingMcpAuth?: McpAuthRequiredEvent | undefined },
  rootModelMessageIds: readonly string[],
): TurnStreamUpdate {
  const content = buildRootAssistantContentForIds(foldState, rootModelMessageIds);
  if (turn.pendingMcpAuth != null) {
    return {
      content: [...content, ...buildMcpAuthTextParts(turn.pendingMcpAuth.mcpServers)],
      status: mcpAuthAssistantStatus(),
      metadata: { custom: mcpAuthMessageCustom(turn.pendingMcpAuth.mcpServers) },
    };
  }
  let update: TurnStreamUpdate = { content };
  update = appendMcpAuthToTurnContent(update.content, turn);
  update = appendToolApprovalToTurnContent(update, turn);
  if (turn.state.status === TURN_STATUS.PAUSED && update.status == null) {
    const approvalThreadId = findFirstPendingApprovalThreadId(foldState);
    const responseThreadId = findFirstPendingResponseThreadId(foldState);
    const custom = {
      ...(approvalThreadId != null ? toolApprovalMessageCustom(approvalThreadId) : {}),
      ...(responseThreadId != null ? toolResponseMessageCustom(responseThreadId) : {}),
    };
    update = {
      content,
      status: approvalThreadId != null ? toolApprovalStatus() : toolResponseStatus(),
      metadata: { custom },
    };
  }
  return update;
}

function contentHasPendingRequiredActions(content: readonly AssistantContentPart[]): boolean {
  const message: ThreadMessage = {
    id: 'pending-check',
    role: 'assistant',
    content,
    status: completeAssistantStatus(),
    createdAt: new Date(),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  };
  return messageHasPendingApprovals(message) || messageHasPendingResponses(message);
}

function resolveProjectedRequiredActionState(
  turnUpdate: TurnStreamUpdate,
  content: readonly AssistantContentPart[],
  record: Pick<Turn, 'state'>,
): { status: MessageStatus; custom: Record<string, unknown> } {
  let status = turnUpdate.status ?? assistantStatusFromTurnState(record.state);
  let custom = { ...(turnUpdate.metadata?.custom ?? {}) };

  if (
    status.type === ASSISTANT_MESSAGE_STATUS_TYPE.REQUIRES_ACTION &&
    status.reason === ASSISTANT_MESSAGE_STATUS_REASON.TOOL_CALLS &&
    !contentHasPendingRequiredActions(content)
  ) {
    status = assistantStatusFromTurnState(record.state);
    custom = Object.fromEntries(
      Object.entries(custom).filter(
        ([key]) =>
          key !== MESSAGE_CUSTOM_KEY.TOOL_APPROVAL_THREAD_ID && key !== MESSAGE_CUSTOM_KEY.TOOL_RESPONSE_THREAD_ID,
      ),
    );
  }

  return { status, custom };
}

function projectActiveStreamUpdate(snapshot: SessionSnapshot): TurnStreamUpdate {
  const activeStream = snapshot.activeStream;
  if (activeStream == null) {
    throw new Error('projectActiveStreamUpdate requires an active stream');
  }

  const hasStagedOverlay =
    snapshot.requiredActions.approvals.size > 0 || snapshot.requiredActions.toolResponses.size > 0;

  // While the user has staged a response locally, keep the paused projection
  // so the interrupt and optimistic result stay paired until server acknowledgement.
  if (hasStagedOverlay) {
    return activeStream.update;
  }

  const baseline = snapshot.groupRootBaseline ?? computeGroupRootBaseline(snapshot.turns);
  const rootModelMessageIds = rootModelMessageIdsSinceBaseline(snapshot.fold, baseline);

  const foldContent = buildRootAssistantContentForIds(snapshot.fold, rootModelMessageIds);
  const content = foldContent.length > 0 ? foldContent : activeStream.update.content;

  const turnRecord = snapshot.turns.find(turn => turn.id === activeStream.turnId);
  const turnLike =
    turnRecord ??
    (snapshot.activeTurn == null
      ? undefined
      : {
          state: snapshot.activeTurn.state,
          pendingMcpAuth: snapshot.pendingMcpAuth,
        });

  const rebuilt =
    turnLike != null ? buildTurnUpdateFromFold(snapshot.fold, turnLike, rootModelMessageIds) : { content };

  const metadata = rebuilt.metadata ?? activeStream.update.metadata;
  const status = rebuilt.status ?? activeStream.update.status;
  return {
    ...activeStream.update,
    content,
    ...(metadata == null ? {} : { metadata }),
    ...(status == null ? {} : { status }),
  };
}

function applyRequiredActionsOverlayToMessages(
  messages: ThreadMessage[],
  overlay: RequiredActionsOverlay,
): ThreadMessage[] {
  if (overlay.approvals.size === 0 && overlay.toolResponses.size === 0) {
    return messages;
  }

  return messages.map(message => {
    if (message.role !== 'assistant') {
      return message;
    }

    let { content } = message;
    if (overlay.approvals.size > 0) {
      content = applyApprovalDecisionsToContent(content, overlay.approvals);
    }
    if (overlay.toolResponses.size > 0) {
      content = applyStagedResponsesToContent(content, overlay.toolResponses);
    }

    if (content === message.content) {
      return message;
    }

    return { ...message, content: [...content] };
  });
}

function projectHistoryTurns(snapshot: SessionSnapshot, options?: ProjectSessionMessagesOptions): ThreadMessage[] {
  const messages: ThreadMessage[] = [];
  let lastAssistantIndex: number | undefined;
  let groupRootIds: string[] = [];
  let sandboxId: string | undefined;

  for (let turnIndex = 0; turnIndex < snapshot.turns.length; turnIndex++) {
    const record = snapshot.turns[turnIndex];
    if (record == null) {
      continue;
    }
    const turnRootIds = record.rootModelMessageIds ?? [];
    sandboxId = record.sandboxId ?? sandboxId;

    if (record.userText !== undefined) {
      groupRootIds = [...turnRootIds];
    } else {
      groupRootIds = [...groupRootIds, ...turnRootIds];
    }

    const turnUpdate = buildTurnUpdateFromFold(snapshot.fold, record, groupRootIds);
    let content = turnUpdate.content;

    const subsequentDecisions = collectSubsequentApprovalDecisions(snapshot.turns, turnIndex);
    if (subsequentDecisions.size > 0) {
      content = applyApprovalDecisionsToContent(content, subsequentDecisions);
    }

    const subsequentResponses = collectSubsequentToolResponses(snapshot.turns, turnIndex);
    if (subsequentResponses.size > 0) {
      content = applyStagedResponsesToContent(content, subsequentResponses);
    }

    const currentResponses = collectToolResponsesFromTurnInput(record.input);
    if (currentResponses.size > 0) {
      content = applyStagedResponsesToContent(content, currentResponses);
    }

    const currentDecisions = collectApprovalDecisionsFromTurnInput(record.input);
    if (currentDecisions.size > 0) {
      content = applyApprovalDecisionsToContent(content, currentDecisions);
    }

    const { status, custom: baseCustom } = resolveProjectedRequiredActionState(turnUpdate, content, record);
    // Continuation turns fold into the previous assistant message and overwrite this custom,
    // so a folded message reports the latest turn that contributed to it — the one whose
    // sandbox wrote the newest artifacts.
    const custom = {
      ...baseCustom,
      [MESSAGE_CUSTOM_KEY.TURN_ID]: record.id,
      ...(sandboxId != null ? { [MESSAGE_CUSTOM_KEY.SANDBOX_ID]: sandboxId } : {}),
    };
    const assistantCreatedAt =
      record.state.status === TURN_STATUS.RUNNING
        ? record.createdAt
        : record.state.status === TURN_STATUS.PAUSED
          ? record.state.pausedAt
          : record.state.completedAt;
    const replaceAssistantCreatedAt = record.state.status !== TURN_STATUS.RUNNING;

    if (record.userText !== undefined) {
      messages.push(buildUserMessageFromTurnInput(record.id, record.input, record.createdAt, options));

      if (record.state.status === TURN_STATUS.RUNNING) {
        if (content.length > 0) {
          messages.push(
            buildAssistantMessage(
              record.id,
              content,
              assistantCreatedAt,
              status,
              custom,
              options,
              replaceAssistantCreatedAt,
            ),
          );
        }
        break;
      }

      if (content.length > 0) {
        messages.push(
          buildAssistantMessage(
            record.id,
            content,
            assistantCreatedAt,
            status,
            custom,
            options,
            replaceAssistantCreatedAt,
          ),
        );
        lastAssistantIndex = messages.length - 1;
      }
    } else if (content.length > 0 && lastAssistantIndex != null) {
      if (record.state.status === TURN_STATUS.RUNNING) {
        break;
      }
      const existing = messages[lastAssistantIndex];
      if (existing?.role !== 'assistant') {
        continue;
      }
      messages[lastAssistantIndex] = {
        ...existing,
        content,
        status,
        createdAt: resolveCreatedAt(existing.id, new Date(assistantCreatedAt), options, true),
        metadata: {
          ...existing.metadata,
          custom,
        },
      };
    } else if (record.state.status === TURN_STATUS.RUNNING) {
      break;
    }
  }

  return messages;
}

export function projectSessionMessages(
  snapshot: SessionSnapshot,
  options?: ProjectSessionMessagesOptions,
): ThreadMessage[] {
  let messages = projectHistoryTurns(snapshot, options);

  if (snapshot.pendingUser != null) {
    messages.push(
      buildUserMessageFromTurnInput(
        snapshot.pendingUser.turnId,
        [{ type: EVENT_TYPE.USER_MESSAGE, content: snapshot.pendingUser.content }],
        snapshot.pendingUser.createdAt,
        options,
      ),
    );
  }

  if (snapshot.activeStream != null) {
    const { turnId, update, segmentStatus } = snapshot.activeStream;
    const resolvedUpdate = segmentStatus === STREAM_SEGMENT_STATUS.OPEN ? update : projectActiveStreamUpdate(snapshot);
    const last = messages.at(-1);
    const existingAssistant =
      last?.role === 'assistant' && last.metadata.custom[MESSAGE_CUSTOM_KEY.TURN_ID] === turnId ? last : undefined;
    const assistantMessage = turnStreamUpdateToAssistantMessage(turnId, resolvedUpdate, existingAssistant, options);
    messages =
      existingAssistant != null ? [...messages.slice(0, -1), assistantMessage] : [...messages, assistantMessage];
  }

  return applyRequiredActionsOverlayToMessages(messages, snapshot.requiredActions);
}

const DEFAULT_LIST_EVENTS_CONCURRENCY = 5;

function ingestTurnsIntoSnapshot(
  snapshot: SessionSnapshot,
  turns: Turn[],
  eventArrays: PersistedTurnEvent[][],
): Turn | undefined {
  let activeTurn: Turn | undefined;
  // Session-scoped: sandbox.created fires when a sandbox is (re)created and the
  // sandbox is reused by later turns, so carry the latest one forward.
  let sessionSandboxId: string | undefined;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    if (turn == null) {
      continue;
    }
    const rootBucket = snapshot.fold.threads.get(ROOT_THREAD_ID);
    const beforeCount = rootBucket?.modelMessageIds.length ?? 0;

    ingestCollectedEventsIntoFold(snapshot.fold, eventArrays[i] ?? []);
    applyUserToolResponsesToFold(snapshot.fold, turn.input ?? []);

    const afterBucket = snapshot.fold.threads.get(ROOT_THREAD_ID);
    const rootModelMessageIds = (afterBucket?.modelMessageIds ?? []).slice(beforeCount);

    const sandboxEvent = (eventArrays[i] ?? []).find(
      (event): event is Extract<TurnEvent, { type: typeof EVENT_TYPE.SANDBOX_CREATED }> =>
        event.type === EVENT_TYPE.SANDBOX_CREATED,
    );
    sessionSandboxId = sandboxEvent?.sandboxId ?? sessionSandboxId;
    let pendingMcpAuth: McpAuthRequiredEvent | undefined;
    for (const event of eventArrays[i] ?? []) {
      if (event.type === EVENT_TYPE.MCP_AUTH_REQUIRED) {
        pendingMcpAuth = event;
      } else if (
        event.type === EVENT_TYPE.USER_MCP_AUTH_CONTINUE ||
        (event.type === EVENT_TYPE.TURN_UPDATE && event.state.status === TURN_STATUS.RUNNING) ||
        event.type === EVENT_TYPE.TURN_DONE
      ) {
        pendingMcpAuth = undefined;
      }
    }

    snapshot.turns.push({
      ...turnToSessionRecord(turn),
      rootModelMessageIds,
      ...(sessionSandboxId != null ? { sandboxId: sessionSandboxId } : {}),
      ...(pendingMcpAuth != null ? { pendingMcpAuth } : {}),
    });
    snapshot.pendingMcpAuth = pendingMcpAuth;

    if (turn.state.status === TURN_STATUS.RUNNING || turn.state.status === TURN_STATUS.PAUSED) {
      activeTurn = turn;
      break;
    }
  }

  return activeTurn;
}

export async function buildSnapshotFromSession(
  server: AgentChatServer,
  sessionId: string,
  concurrency: number = DEFAULT_LIST_EVENTS_CONCURRENCY,
): Promise<SessionSnapshot> {
  // Completed history comes from session-level listEvents. The session API
  // excludes the running turn — hydrate that turn via listTurnEvents so
  // convertTurnsToThreadMessages still surfaces in-flight content.
  const snapshot = await buildSnapshotFromSessionEvents(server, sessionId);
  if (snapshot.activeTurn == null) {
    return snapshot;
  }

  const turn = snapshot.activeTurn;
  const eventArrays = await fetchAllTurnEventsWithConcurrency(server, sessionId, [turn], concurrency);
  ingestTurnsIntoSnapshot(snapshot, [turn], eventArrays);

  // Hydrated in-flight content lives in `turns` / `fold` now — drop the
  // reconnect seed so projection does not duplicate the user bubble.
  const snapshotWithoutPendingUser = { ...snapshot };
  delete snapshotWithoutPendingUser.pendingUser;
  return replaceSessionSnapshot(snapshotWithoutPendingUser, {
    activeTurn: turn,
    unstable_resume: true,
    groupRootBaseline: computeGroupRootBaseline(snapshot.turns),
  });
}

/**
 * Rebuilds the conversation through `anchorTurnId`, including that turn.
 * The server follows parent links from the anchor, so turns from abandoned
 * branches are excluded. A null anchor represents an empty conversation.
 */
export async function buildSnapshotThroughTurn(
  server: AgentChatServer,
  sessionId: string,
  anchorTurnId: string | null,
): Promise<SessionSnapshot> {
  if (anchorTurnId == null) {
    return createEmptySessionSnapshot();
  }
  const items = await fetchAllSessionEvents(server, sessionId, {
    lastTurnId: anchorTurnId,
  });
  const snapshot = createEmptySessionSnapshot();
  ingestSessionEventsIntoSnapshot(snapshot, items);
  return snapshot;
}

/**
 * Resolves `previousTurnId` for edit/retry of `turnId` from the turn's own
 * parent pointer (`"none"` for roots). Independent of listTurns order.
 */
export async function resolveGatewayBranchPreviousTurnIdForTurn(
  server: AgentChatServer,
  sessionId: string,
  turnId: string,
): Promise<string> {
  const turn = await server.getTurn({ sessionId, turnId });
  return turn.previousTurnId ?? 'none';
}

export async function buildTurnAssistantContent(
  server: AgentChatServer,
  sessionId: string,
  turn: Pick<Turn, 'id' | 'state'>,
  foldState?: PeerThreadFoldState,
): Promise<AssistantContentPart[]> {
  const state = foldState ?? new PeerThreadFoldState();
  const beforeCount = state.threads.get(ROOT_THREAD_ID)?.modelMessageIds.length ?? 0;
  await ingestTurnEventsIntoFold(server, sessionId, turn.id, state);
  const afterIds = state.threads.get(ROOT_THREAD_ID)?.modelMessageIds ?? [];
  const rootModelMessageIds = afterIds.slice(beforeCount);
  return buildTurnUpdateFromFold(state, turn, rootModelMessageIds).content;
}

export async function convertTurnsToThreadMessages(
  server: AgentChatServer,
  sessionId: string,
): Promise<ConvertTurnsResult> {
  const snapshot = await buildSnapshotFromSession(server, sessionId);
  const messages = projectSessionMessages(snapshot);

  return {
    messages,
    foldState: snapshot.fold,
    ...(snapshot.activeTurn != null
      ? {
          activeTurn: snapshot.activeTurn,
          unstable_resume: true,
        }
      : {}),
  };
}

export function getTurnMessageContent(message: AppendMessage): string {
  const parts: string[] = [];
  for (const part of message.content) {
    if (part.type === 'text') {
      parts.push(part.text);
    }
  }
  const text = parts.join('\n').trim();
  if (!text) {
    throw new Error('User message must contain text content.');
  }
  return text;
}

type UserMessageContentItem = Exclude<UserMessageContent, string>[number];
type FileContent = Extract<UserMessageContentItem, { type: 'file' }>;
type TextContent = Extract<UserMessageContentItem, { type: 'text' }>;

function toFileDataUri(data: string, mimeType: string): string {
  // FileContent expects a data URI (`data:<mime>;base64,<payload>`).
  // Attachment adapters typically already produce one via FileReader.readAsDataURL;
  // only wrap bare base64 payloads.
  if (data.startsWith('data:')) {
    return data;
  }
  return `data:${mimeType};base64,${data}`;
}

function toFileContent(name: string, data: string, mimeType: string): FileContent {
  return {
    type: 'file',
    name,
    data: toFileDataUri(data, mimeType),
  };
}

/**
 * Builds the gateway turn input content from a composer message, forwarding
 * attachments as SDK `FileContent` parts. Mirrors how assistant-ui surfaces
 * attachment content on `message.attachments[].content`.
 */
export function buildUserMessageContent(message: AppendMessage): UserMessageContent {
  const inputParts = [
    ...message.content,
    ...(message.attachments?.flatMap(attachment =>
      attachment.content.map(part => ({
        ...part,
        filename: attachment.name,
      })),
    ) ?? []),
  ];

  const items: UserMessageContentItem[] = [];
  for (const part of inputParts) {
    switch (part.type) {
      case 'text':
        if (part.text.trim().length > 0) {
          const textPart: TextContent = { type: 'text', text: part.text };
          items.push(textPart);
        }
        break;
      case 'image':
        items.push(toFileContent(part.filename ?? 'image', part.image, 'image/png'));
        break;
      case 'file':
        items.push(toFileContent(part.filename ?? 'file', part.data, part.mimeType));
        break;
      default:
        break;
    }
  }

  const hasFile = items.some((item): item is FileContent => item.type === 'file');
  if (!hasFile) {
    // Text-only: keep the string form and the non-empty invariant.
    return getTurnMessageContent(message);
  }
  return items;
}

/** Derives display text from gateway user-message content (drops file parts). */
export function userMessageContentToText(content: UserMessageContent): string {
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((item): item is TextContent => item.type === 'text')
    .map(item => item.text)
    .join('\n')
    .trim();
}

/** Strips the `-user` suffix from a projected user message id to recover the turn id. */
export function parseTurnIdFromMessageId(messageId: string): string {
  return messageId.endsWith(MESSAGE_ID_SUFFIX.USER) ? messageId.slice(0, -MESSAGE_ID_SUFFIX.USER.length) : messageId;
}

/** Parent turn id for branching before `turnId`; `null` when editing the first turn. */
export function resolveBranchPreviousTurnId(turns: readonly SessionTurnRecord[], turnId: string): string | null {
  const turnIndex = turns.findIndex(turn => turn.id === turnId);
  if (turnIndex <= 0) {
    return null;
  }
  return turns[turnIndex - 1]?.id ?? null;
}

/** Extracts edited text from an assistant-ui append message (text parts only). */
export function extractEditedText(message: AppendMessage): string {
  return getTurnMessageContent(message);
}

/** Original gateway user-message content from a turn record (for reset). */
export function extractTurnUserMessageContent(input: TurnInputItem[] | undefined): UserMessageContent {
  for (const item of input ?? []) {
    if (item.type === EVENT_TYPE.USER_MESSAGE) {
      return item.content;
    }
  }
  return '';
}

/**
 * Builds resubmit content for a text-only edit: replaces text with `editedText`
 * while preserving original file parts from the turn record.
 */
export function buildEditedUserMessageContent(
  editedText: string,
  originalInput: TurnInputItem[] | undefined,
): UserMessageContent {
  const fileParts: FileContent[] = [];
  for (const item of originalInput ?? []) {
    if (item.type !== EVENT_TYPE.USER_MESSAGE) {
      continue;
    }
    const content = item.content;
    if (typeof content === 'string') {
      continue;
    }
    for (const part of content) {
      if (part.type === 'file') {
        fileParts.push(part);
      }
    }
  }

  if (fileParts.length === 0) {
    return editedText;
  }

  const items: UserMessageContentItem[] = [];
  if (editedText.trim().length > 0) {
    items.push({ type: 'text', text: editedText });
  }
  items.push(...fileParts);
  return items;
}

function buildMcpAuthUpdate(
  pendingMcpAuth: McpAuthRequiredEvent,
  foldState: PeerThreadFoldState,
  groupRootBaseline?: readonly string[],
): TurnStreamUpdate {
  const base =
    groupRootBaseline != null
      ? buildRootAssistantContentForIds(foldState, rootModelMessageIdsSinceBaseline(foldState, groupRootBaseline))
      : buildRootAssistantContent(foldState);
  return {
    content: [...base, ...buildMcpAuthTextParts()],
    status: mcpAuthAssistantStatus(),
    metadata: { custom: mcpAuthMessageCustom(pendingMcpAuth.mcpServers) },
  };
}

export async function* streamTurnEvents(
  stream: AsyncIterable<TurnStreamData>,
  foldState: PeerThreadFoldState,
  groupRootBaseline?: readonly string[],
  onTurnIdAvailable?: (turnId: string) => void,
): AsyncGenerator<TurnStreamUpdate> {
  let pendingMcpAuth: McpAuthRequiredEvent | undefined;
  let sandboxId: string | undefined;
  let sandboxIdYielded = false;

  const withSandbox = (update: TurnStreamUpdate): TurnStreamUpdate => {
    if (sandboxId == null) {
      return update;
    }
    return {
      ...update,
      metadata: {
        ...update.metadata,
        custom: { ...update.metadata?.custom, [MESSAGE_CUSTOM_KEY.SANDBOX_ID]: sandboxId },
      },
    };
  };

  const yieldContent = (): AssistantContentPart[] | undefined => {
    const ids =
      groupRootBaseline != null
        ? rootModelMessageIdsSinceBaseline(foldState, groupRootBaseline)
        : (foldState.threads.get(ROOT_THREAD_ID)?.modelMessageIds ?? []);
    const content = buildRootAssistantContentForIds(foldState, ids);
    return content.length > 0 ? content : undefined;
  };

  const buildRequiredActionUpdate = (): TurnStreamUpdate => {
    if (pendingMcpAuth != null) {
      return buildMcpAuthUpdate(pendingMcpAuth, foldState, groupRootBaseline);
    }

    const approvalThreadId = findFirstPendingApprovalThreadId(foldState);
    const responseThreadId = findFirstPendingResponseThreadId(foldState);
    const custom: Record<string, unknown> = {};
    if (approvalThreadId != null) {
      Object.assign(custom, toolApprovalMessageCustom(approvalThreadId));
    }
    if (responseThreadId != null) {
      Object.assign(custom, toolResponseMessageCustom(responseThreadId));
    }
    return {
      content: yieldContent() ?? [],
      status: approvalThreadId != null ? toolApprovalStatus() : toolResponseStatus(),
      metadata: { custom },
    };
  };

  for await (const data of stream) {
    const event = data.event;

    if (event.type === EVENT_TYPE.TURN_CREATED) {
      onTurnIdAvailable?.(event.turnId);
      continue;
    }

    if (event.type === EVENT_TYPE.SANDBOX_CREATED) {
      sandboxId = event.sandboxId;
      continue;
    }

    if (event.type === EVENT_TYPE.MCP_AUTH_REQUIRED) {
      pendingMcpAuth = event;
      continue;
    }

    if (event.type === EVENT_TYPE.USER_MCP_AUTH_CONTINUE) {
      pendingMcpAuth = undefined;
      ingestStreamEvent(foldState, event);
      continue;
    }

    if (event.type === EVENT_TYPE.TURN_UPDATE) {
      if (event.state.status === TURN_STATUS.RUNNING) {
        pendingMcpAuth = undefined;
        yield withSandbox({
          content: yieldContent() ?? [],
          status: runningAssistantStatus(),
          sequenceNumber: data.sequenceNumber,
          turnState: { status: TURN_STATUS.RUNNING },
        });
        continue;
      }

      // A paused SSE segment ending is expected. The logical turn remains
      // active and can only transition back to running through server events.
      yield withSandbox({
        ...buildRequiredActionUpdate(),
        sequenceNumber: data.sequenceNumber,
        turnState: {
          status: TURN_STATUS.PAUSED,
          actionRequiredOnEvents: event.state.actionRequiredOnEvents,
          pausedAt: event.state.pausedAt,
          ...(event.state.expiresAt != null ? { expiresAt: event.state.expiresAt } : {}),
        },
      });
      return;
    }

    if (event.type === EVENT_TYPE.TURN_DONE) {
      // turn.done is the only successful terminal boundary. Do not wait for
      // the transport body to close because resumable subscriptions may linger.
      yield withSandbox({
        content: yieldContent() ?? [],
        status: assistantStatusFromTurnState(event.state),
        sequenceNumber: data.sequenceNumber,
        turnState: event.state,
      });
      return;
    }

    if (!ingestStreamEvent(foldState, event)) {
      continue;
    }

    const content = yieldContent();
    if (content != null) {
      if (sandboxId != null) {
        sandboxIdYielded = true;
      }
      yield withSandbox({ content, sequenceNumber: data.sequenceNumber });
    }
  }

  if (sandboxId != null && !sandboxIdYielded) {
    const ids =
      groupRootBaseline != null
        ? rootModelMessageIdsSinceBaseline(foldState, groupRootBaseline)
        : (foldState.threads.get(ROOT_THREAD_ID)?.modelMessageIds ?? []);
    yield withSandbox({ content: buildRootAssistantContentForIds(foldState, ids) });
  }
}

export function turnStreamUpdateToAssistantMessage(
  turnId: string,
  update: TurnStreamUpdate,
  existing?: ThreadMessage,
  options?: ProjectSessionMessagesOptions,
): ThreadMessage {
  const id = existing?.role === 'assistant' ? existing.id : `${turnId}${MESSAGE_ID_SUFFIX.ASSISTANT}`;
  const fallbackCreatedAt = existing?.createdAt ?? new Date();
  return {
    id,
    role: 'assistant',
    content: update.content,
    status: update.status ?? runningAssistantStatus(),
    createdAt: resolveCreatedAt(id, fallbackCreatedAt, options),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {
        ...(existing?.role === 'assistant' ? existing.metadata.custom : {}),
        ...update.metadata?.custom,
        [MESSAGE_CUSTOM_KEY.TURN_ID]: turnId,
      },
    },
  };
}

export function repositoryItemsFromMessages(messages: readonly ThreadMessage[]): ExportedMessageRepositoryItem[] {
  const items: ExportedMessageRepositoryItem[] = [];
  let parentId: string | null = null;
  for (const message of messages) {
    items.push({ parentId, message });
    parentId = message.id;
  }
  return items;
}

export type { ProjectSessionMessagesOptions, SessionSnapshot } from './sessionSnapshot.js';
