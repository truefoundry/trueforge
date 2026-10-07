import type { MessageStatus } from '@assistant-ui/core';

import type { AssistantContentPart } from './modelMessageContent.js';
import type { TurnState } from './server/index.js';

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
