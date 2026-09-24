import type { ThreadMessage } from '@assistant-ui/core';

import { isRequiresAction } from './assistantMessageStatus.js';
import { messageHasPendingApprovals } from './toolApproval.js';
import { messageHasPendingResponses } from './toolResponse.js';

export function messageHasPendingRequiredActions(message: ThreadMessage | undefined): boolean {
  return messageHasPendingApprovals(message) || messageHasPendingResponses(message);
}

export function findPausedAssistantMessage(
  messages: readonly ThreadMessage[],
): Extract<ThreadMessage, { role: 'assistant' }> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (candidate?.role === 'assistant' && isRequiresAction(candidate.status)) {
      return candidate;
    }
  }
  return undefined;
}
