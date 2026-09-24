import type { MessageStatus } from '@assistant-ui/core';

export const ASSISTANT_MESSAGE_STATUS_TYPE = {
  COMPLETE: 'complete',
  INCOMPLETE: 'incomplete',
  REQUIRES_ACTION: 'requires-action',
  RUNNING: 'running',
} as const;

export const ASSISTANT_MESSAGE_STATUS_REASON = {
  CANCELLED: 'cancelled',
  ERROR: 'error',
  INTERRUPT: 'interrupt',
  STOP: 'stop',
  TOOL_CALLS: 'tool-calls',
  UNKNOWN: 'unknown',
} as const;

export function completeAssistantStatus(): MessageStatus {
  return {
    type: ASSISTANT_MESSAGE_STATUS_TYPE.COMPLETE,
    reason: ASSISTANT_MESSAGE_STATUS_REASON.STOP,
  };
}

export function runningAssistantStatus(): MessageStatus {
  return { type: ASSISTANT_MESSAGE_STATUS_TYPE.RUNNING };
}

export function toolCallsRequiredAssistantStatus(): MessageStatus {
  return {
    type: ASSISTANT_MESSAGE_STATUS_TYPE.REQUIRES_ACTION,
    reason: ASSISTANT_MESSAGE_STATUS_REASON.TOOL_CALLS,
  };
}

export function interruptRequiredAssistantStatus(): MessageStatus {
  return {
    type: ASSISTANT_MESSAGE_STATUS_TYPE.REQUIRES_ACTION,
    reason: ASSISTANT_MESSAGE_STATUS_REASON.INTERRUPT,
  };
}

export function isRequiresAction(status: MessageStatus | undefined): boolean {
  return status?.type === ASSISTANT_MESSAGE_STATUS_TYPE.REQUIRES_ACTION;
}

export function isRequiresActionToolCalls(status: MessageStatus | undefined): boolean {
  return (
    status?.type === ASSISTANT_MESSAGE_STATUS_TYPE.REQUIRES_ACTION &&
    status.reason === ASSISTANT_MESSAGE_STATUS_REASON.TOOL_CALLS
  );
}
