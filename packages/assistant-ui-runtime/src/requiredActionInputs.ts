import type { ThreadMessage } from '@assistant-ui/core';
import type { TurnInputItem, UserToolApprovalEvent, UserToolResponseEvent } from './server/index.js';

import { ROOT_THREAD_ID } from './constants.js';
import { collectApprovalInputs, messageHasPendingApprovals } from './toolApproval.js';
import { collectResponseInputs, messageHasPendingResponses } from './toolResponse.js';

export type RequiredActionInput = Extract<TurnInputItem, UserToolApprovalEvent | UserToolResponseEvent>;

export function messageHasPendingRequiredActions(message: ThreadMessage | undefined): boolean {
  return messageHasPendingApprovals(message) || messageHasPendingResponses(message);
}

export function collectRequiredActionInputs(
  message: ThreadMessage,
  defaultThreadId: string = ROOT_THREAD_ID,
): RequiredActionInput[] {
  if (messageHasPendingRequiredActions(message)) {
    return [];
  }
  return [...collectApprovalInputs(message, defaultThreadId), ...collectResponseInputs(message, defaultThreadId)];
}

export function isRequiredActionInput(item: TurnInputItem): item is RequiredActionInput {
  return item.type === 'user.tool_approval' || item.type === 'user.tool_response';
}

export function findPausedAssistantMessage(
  messages: readonly ThreadMessage[],
): Extract<ThreadMessage, { role: 'assistant' }> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const candidate = messages[i];
    if (candidate?.role === 'assistant' && candidate.status.type === 'requires-action') {
      return candidate;
    }
  }
  return undefined;
}
