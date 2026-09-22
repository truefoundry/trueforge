import type { MessageStatus } from '@assistant-ui/core';

import type { AssistantContentPart } from './modelMessageContent.js';

export interface TurnStreamUpdate {
  content: AssistantContentPart[];
  status?: MessageStatus;
  metadata?: {
    custom?: Record<string, unknown>;
  };
}
