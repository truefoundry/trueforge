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

/**
 * Most recent assistant that is still awaiting action, ignoring a trailing
 * non-paused assistant (optimistic/running bubble). Returns undefined when a
 * later user message has abandoned the pause.
 */
export function findCurrentPausedAssistantMessage(
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
    if (candidate.status.type === 'requires-action') {
      return candidate;
    }
    // Skip a trailing non-paused assistant (streaming/complete bubble).
  }
  return undefined;
}

/** @deprecated Prefer {@link findCurrentPausedAssistantMessage}. */
export function findPausedAssistantMessage(
  messages: readonly ThreadMessage[],
): Extract<ThreadMessage, { role: 'assistant' }> | undefined {
  return findCurrentPausedAssistantMessage(messages);
}
