import type {
  McpAuthRequiredEvent,
  Turn,
  TurnCreatedEvent,
  TurnDoneEvent,
  TurnEvent,
  TurnInputItem,
} from './server/index.js';

import { extractTurnUserText } from './extractTurnUserText.js';
import { PeerThreadFoldState } from './foldPeerThreads.js';
import type { StoredApprovalDecision } from './toolApproval.js';
import type { StoredToolResponse } from './toolResponse.js';
import type { TurnStreamUpdate } from './turnStreamUpdate.js';

/** Session-level event item from `AgentSession.listEvents`. */
export interface GatewaySessionEventItem {
  turnId: string;
  event: TurnCreatedEvent | TurnDoneEvent | TurnEvent;
}

/** Cursor for fetching older `listEvents` pages (scroll-up history). */
export interface SessionHistoryPagination {
  /** Token for the next older page; omit when exhausted. */
  olderPageToken?: string | undefined;
  hasOlder: boolean;
}

/** Turn metadata retained for cross-turn projection and subsequent required-action replay. */
export type SessionTurnRecord = Pick<Turn, 'id' | 'createdAt' | 'state' | 'input'> & {
  /** Denormalized from `input` for user/assistant interleaving during projection. */
  userText?: string | undefined;
  /** Root-thread `model.message` ids ingested with this turn (for per-group projection). */
  rootModelMessageIds?: readonly string[] | undefined;
  /** sandboxId observed via `sandbox.created` on this or an earlier turn (session-scoped). */
  sandboxId?: string | undefined;
};

export interface RequiredActionsOverlay {
  approvals: Map<string, StoredApprovalDecision>;
  toolResponses: Map<string, StoredToolResponse>;
}

export interface ActiveStreamState {
  turnId: string;
  update: TurnStreamUpdate;
  isContinuation: boolean;
  streamComplete?: boolean | undefined;
}

export interface PendingUserMessage {
  turnId: string;
  /** Gateway user.message content (text-only string or text/file parts). */
  content: Extract<TurnInputItem, { type: 'user.message' }>['content'];
  createdAt: Date;
}

export interface SessionSnapshot {
  fold: PeerThreadFoldState;
  turns: SessionTurnRecord[];
  pendingMcpAuth?: McpAuthRequiredEvent | undefined;
  pendingUser?: PendingUserMessage | undefined;
  activeStream?: ActiveStreamState | undefined;
  /** Root `model.message` ids present before the active turn group started (streaming scope). */
  groupRootBaseline?: readonly string[] | undefined;
  requiredActions: RequiredActionsOverlay;
  runningTurn?: Turn | undefined;
  unstable_resume?: boolean | undefined;
  /**
   * Chronological `listEvents` items loaded so far (for prepend-on-scroll rebuild).
   * Live stream commits are not appended here — they live in `turns` / `fold`.
   */
  historyEvents?: readonly GatewaySessionEventItem[] | undefined;
  historyPagination?: SessionHistoryPagination | undefined;
}

export interface ProjectSessionMessagesOptions {
  getCreatedAt?: (messageId: string, fallback: Date, replace?: boolean) => Date;
}

export function emptyRequiredActionsOverlay(): RequiredActionsOverlay {
  return {
    approvals: new Map(),
    toolResponses: new Map(),
  };
}

export function createEmptySessionSnapshot(): SessionSnapshot {
  return {
    fold: new PeerThreadFoldState(),
    turns: [],
    requiredActions: emptyRequiredActionsOverlay(),
  };
}

export function turnToSessionRecord(turn: Turn): SessionTurnRecord {
  const userText = extractTurnUserText(turn.input);
  return {
    id: turn.id,
    ...(userText !== undefined ? { userText } : {}),
    createdAt: turn.createdAt,
    state: turn.state,
    input: turn.input ?? [],
  };
}

/** Builds a SessionTurnRecord from session-level TurnCreatedEvent + TurnDoneEvent data. */
export function sessionEventsToSessionRecord(
  turnId: string,
  createdEvent: TurnCreatedEvent,
  doneEvent: TurnDoneEvent,
  rootModelMessageIds: readonly string[],
  sandboxId?: string,
): SessionTurnRecord {
  const userText = extractTurnUserText(createdEvent.input);
  return {
    id: turnId,
    ...(userText !== undefined ? { userText } : {}),
    createdAt: createdEvent.createdAt,
    state: doneEvent.state,
    input: createdEvent.input ?? [],
    rootModelMessageIds,
    ...(sandboxId != null ? { sandboxId } : {}),
  };
}

/** Returns a new snapshot wrapper; fold maps may be mutated in place before calling. */
export function replaceSessionSnapshot(
  snapshot: SessionSnapshot,
  patch: Partial<Omit<SessionSnapshot, 'requiredActions'>> & {
    requiredActions?: RequiredActionsOverlay;
  },
): SessionSnapshot {
  return {
    ...snapshot,
    ...patch,
    ...(patch.requiredActions != null ? { requiredActions: patch.requiredActions } : {}),
  };
}

export function cloneRequiredActionsOverlay(overlay: RequiredActionsOverlay): RequiredActionsOverlay {
  return {
    approvals: new Map(overlay.approvals),
    toolResponses: new Map(overlay.toolResponses),
  };
}
