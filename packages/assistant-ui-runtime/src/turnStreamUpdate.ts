import type { MessageStatus } from '@assistant-ui/core';

import type { AssistantContentPart } from './modelMessageContent.js';
import { EVENT_TYPE } from './server/events.js';
import type { TurnState } from './server/index.js';

/** Resume cursor chosen from the last event the client applied. */
export type TurnSubscribeCursor = { fromEventId: string } | { afterEventId: string };

/** A model message replays from its shell. Every other event resumes after itself. */
export function subscribeCursorForEvent(event: { type: string; id: string }): TurnSubscribeCursor {
  if (event.type === EVENT_TYPE.MODEL_MESSAGE || event.type === EVENT_TYPE.MODEL_MESSAGE_DELTA) {
    return { fromEventId: event.id };
  }
  return { afterEventId: event.id };
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
