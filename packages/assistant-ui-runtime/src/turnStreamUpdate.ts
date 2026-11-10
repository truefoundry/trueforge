import type { MessageStatus } from '@assistant-ui/core';

import type { AssistantContentPart } from './modelMessageContent.js';
import { EVENT_TYPE } from './server/events.js';
import type { TurnState } from './server/index.js';

/** Resume cursor chosen from the last event the client applied. */
export type TurnSubscribeCursor = { fromEventId: string } | { afterEventId: string };

/**
 * A model message replays from its shell. When several messages are still open,
 * replay starts at the earliest shell so a later message's deltas are not appended
 * onto an earlier message that was already folded. `mcp.auth_required` is replayed
 * too: the connect prompt lives only on that event, and the next `turn.update`
 * does not repeat it. Every other event resumes after itself.
 */
export function subscribeCursorForEvent(
  event: { type: string; id: string },
  earliestOpenModelMessageId?: string,
): TurnSubscribeCursor {
  if (event.type === EVENT_TYPE.MODEL_MESSAGE || event.type === EVENT_TYPE.MODEL_MESSAGE_DELTA) {
    const fromEventId =
      earliestOpenModelMessageId !== undefined && earliestOpenModelMessageId < event.id
        ? earliestOpenModelMessageId
        : event.id;
    return { fromEventId };
  }
  if (event.type === EVENT_TYPE.MCP_AUTH_REQUIRED) {
    return { fromEventId: event.id };
  }
  return { afterEventId: event.id };
}

function isRunningState(state: unknown): boolean {
  return typeof state === 'object' && state !== null && 'status' in state && state.status === 'running';
}

/**
 * Newest event first. A pending `mcp.auth_required` stays the cursor even when a
 * later paused `turn.update` is the last stored row: the prompt is only on that event.
 */
export function cursorFromTurnEvents(
  eventsNewestFirst: readonly { type: string; id: string; state?: unknown }[],
): TurnSubscribeCursor | undefined {
  let newest: TurnSubscribeCursor | undefined;
  for (const event of eventsNewestFirst) {
    newest ??= subscribeCursorForEvent(event);
    if (event.type === EVENT_TYPE.MCP_AUTH_REQUIRED) {
      return { fromEventId: event.id };
    }
    const promptEnded =
      event.type === EVENT_TYPE.USER_MCP_AUTH_CONTINUE ||
      event.type === EVENT_TYPE.TURN_DONE ||
      (event.type === EVENT_TYPE.TURN_UPDATE && isRunningState(event.state));
    if (promptEnded) {
      return newest;
    }
  }
  return newest;
}

/**
 * Resume of one model message replays every event after its shell. If an older
 * message is still open, start at that shell instead so its later deltas rebuild
 * the message rather than appending to the copy already in the fold.
 */
export function resumeCursorCoveringOpenModelMessages(
  cursor: TurnSubscribeCursor | undefined,
  earliestOpenModelMessageId: string | undefined,
): TurnSubscribeCursor | undefined {
  if (cursor === undefined || !('fromEventId' in cursor)) {
    return cursor;
  }
  if (earliestOpenModelMessageId === undefined || earliestOpenModelMessageId >= cursor.fromEventId) {
    return cursor;
  }
  return { fromEventId: earliestOpenModelMessageId };
}

/** Deliveries of one cursor, kept so a replay of the same events is not new progress. */
export function createSubscribeReplayProgress(): {
  beginAttempt: () => void;
  observe: (cursor: TurnSubscribeCursor) => boolean;
} {
  const mostDelivered = new Map<string, number>();
  let thisAttempt = new Map<string, number>();
  return {
    beginAttempt() {
      thisAttempt = new Map();
    },
    /** True when this attempt delivered more of this cursor than any earlier attempt. */
    observe(cursor) {
      const key = 'fromEventId' in cursor ? `from:${cursor.fromEventId}` : `after:${cursor.afterEventId}`;
      const seen = (thisAttempt.get(key) ?? 0) + 1;
      thisAttempt.set(key, seen);
      const most = mostDelivered.get(key) ?? 0;
      if (seen <= most) {
        return false;
      }
      mostDelivered.set(key, seen);
      return true;
    },
  };
}

export interface TurnStreamUpdate {
  content: AssistantContentPart[];
  status?: MessageStatus;
  /** Last SSE sequence number observed for this update (reconnect cursor). */
  sequenceNumber?: number;
  /**
   * Logical turn state is independent from the SSE connection. In particular,
   * a paused segment may close while the turn remains active.
   */
  turnState?: TurnState;
  metadata?: {
    custom?: Record<string, unknown>;
  };
}
