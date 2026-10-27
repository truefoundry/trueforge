import type { MessageStatus } from '@assistant-ui/core';

import type { AssistantContentPart } from './modelMessageContent.js';

export interface TurnStreamUpdate {
  content: AssistantContentPart[];
  status?: MessageStatus;
  /** Last SSE sequence number observed for this update (reconnect cursor). */
  sequenceNumber?: number;
  metadata?: {
    custom?: Record<string, unknown>;
  };
}
