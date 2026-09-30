import type { MessageStatus } from '@assistant-ui/core';

import type { AssistantContentPart } from './modelMessageContent.js';
import type { TurnState } from './server/index.js';

export interface TurnStreamUpdate {
  content: AssistantContentPart[];
  status?: MessageStatus;
  /** Latest durable sequence observed while producing this projection. */
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
