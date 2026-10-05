import type { ThreadMessage } from '@assistant-ui/core';

import { isRequiresAction } from './assistantMessageStatus.js';
import { messageHasPendingApprovals } from './toolApproval.js';
import { messageHasPendingResponses } from './toolResponse.js';

export function messageHasPendingRequiredActions(message: ThreadMessage | undefined): boolean {
  return messageHasPendingApprovals(message) || messageHasPendingResponses(message);
}

/**
 * Most recent assistant that is still awaiting action, ignoring a trailing
 * non-paused assistant (optimistic/running bubble). Returns undefined when a
 * later user message has abandoned the pause.
 */
export function findPausedAssistantMessage(
  messages: readonly ThreadMessage[],
): Extract<ThreadMessage, { role: 'assistant' }> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (candidate == null) {
      continue;
    }
    if (candidate.role === 'user') {
      return undefined;
    }
    if (candidate.role !== 'assistant') {
      continue;
    }
    if (isRequiresAction(candidate.status)) {
      return candidate;
    }
    // Skip a trailing non-paused assistant (streaming/complete bubble).
  }
  return undefined;
}
