import type {
  MessageStatus,
  ThreadAssistantMessage,
  ThreadAssistantMessagePart,
  ThreadMessage,
} from '@assistant-ui/core';
import {
  completeAssistantStatus,
  isRequiresActionToolCalls,
  toolCallsRequiredAssistantStatus,
} from './assistantMessageStatus.js';
import type { ToolResponseRequiredEvent, Turn, TurnInputItem, UserToolResponseInputEvent } from './server/index.js';
import { APPROVAL_DECISION_STATUS, EVENT_TYPE, TURN_STATUS } from './server/index.js';

import { ROOT_THREAD_ID } from './constants.js';
import { recordToolApprovalInFold, recordToolResponseInFold, type PeerThreadFoldState } from './foldPeerThreads.js';
import { MESSAGE_CUSTOM_KEY, type ToolResponseMessageCustomMetadata } from './messageCustomMetadata.js';
import type { TurnStreamUpdate } from './turnStreamUpdate.js';

export { ROOT_THREAD_ID } from './constants.js';

export interface AskUserQuestionInterruptPayload {
  question?: string;
  options?: string[];
}

export type StoredToolResponse = Pick<UserToolResponseInputEvent, 'content'>;

export type RespondToToolResponseOptions = Pick<UserToolResponseInputEvent, 'toolCallId' | 'content'>;

type ToolCallPart = Extract<ThreadMessage['content'][number], { type: 'tool-call' }>;

type AssistantToolCallPart = Extract<ThreadAssistantMessagePart, { type: 'tool-call' }>;

export function hasPendingToolResponse(part: Pick<ToolCallPart, 'interrupt' | 'result'>): boolean {
  return part.interrupt != null && part.result === undefined;
}

function isStagedResponseAwaitingSdk(part: ToolCallPart): boolean {
  return part.interrupt != null && part.result !== undefined;
}

export function toolResponseStatus(): MessageStatus {
  return toolCallsRequiredAssistantStatus();
}

export function toolResponseMessageCustom(threadId: string): ToolResponseMessageCustomMetadata {
  return {
    [MESSAGE_CUSTOM_KEY.TOOL_RESPONSE_THREAD_ID]: threadId === ROOT_THREAD_ID ? ROOT_THREAD_ID : threadId,
  };
}

export function getToolResponseThreadId(message: ThreadMessage | undefined): string | undefined {
  if (message?.role !== 'assistant') {
    return undefined;
  }
  const threadId = message.metadata.custom[MESSAGE_CUSTOM_KEY.TOOL_RESPONSE_THREAD_ID];
  return typeof threadId === 'string' ? threadId : undefined;
}

export function findResponseRequiredInTurn(turn: Pick<Turn, 'state'>): ToolResponseRequiredEvent | undefined {
  // Historical turns encoded pauses as done + requiredActions. New paused
  // turns derive pending responses from their persisted event fold instead.
  if (turn.state.status !== TURN_STATUS.DONE) {
    return undefined;
  }
  const found = turn.state.requiredActions?.find(action => action.type === EVENT_TYPE.TOOL_RESPONSE_REQUIRED);
  return found?.type === EVENT_TYPE.TOOL_RESPONSE_REQUIRED ? found : undefined;
}

function applyToolResponseToToolCall(part: AssistantToolCallPart, content: string): AssistantToolCallPart {
  return { ...part, result: content };
}

function updateToolResponseInContent(
  content: readonly ThreadAssistantMessagePart[],
  options: RespondToToolResponseOptions,
): { content: readonly ThreadAssistantMessagePart[]; found: boolean } {
  let found = false;
  const newContent = content.map(part => {
    if (part.type !== 'tool-call') {
      return part;
    }

    if (part.toolCallId === options.toolCallId && hasPendingToolResponse(part)) {
      found = true;
      return applyToolResponseToToolCall(part, options.content);
    }

    if (part.messages == null) {
      return part;
    }

    const messages = part.messages.map(message => {
      if (message.role !== 'assistant') {
        return message;
      }
      const nested = updateToolResponseInContent(message.content, options);
      if (!nested.found) {
        return message;
      }
      found = true;
      return { ...message, content: nested.content };
    });
    return { ...part, messages };
  });

  return { content: newContent, found };
}

export function applyToolResponseToMessage(
  message: ThreadAssistantMessage,
  options: RespondToToolResponseOptions,
): ThreadAssistantMessage {
  const { content } = updateToolResponseInContent(message.content, options);
  return { ...message, content: [...content] };
}

function nestedMessagesHavePendingResponses(messages: readonly ThreadMessage[]): boolean {
  for (const message of messages) {
    if (messageHasPendingResponses(message)) {
      return true;
    }
  }
  return false;
}

export function messageHasPendingResponses(message: ThreadMessage | undefined): boolean {
  if (message?.role !== 'assistant') {
    return false;
  }
  for (const part of message.content) {
    if (part.type !== 'tool-call') {
      continue;
    }
    if (hasPendingToolResponse(part)) {
      return true;
    }
    if (part.messages != null && nestedMessagesHavePendingResponses(part.messages)) {
      return true;
    }
  }
  return false;
}

function contentHasPendingResponses(content: readonly ThreadAssistantMessagePart[]): boolean {
  return messageHasPendingResponses({
    id: 'pending-check',
    role: 'assistant',
    content,
    status: completeAssistantStatus(),
    createdAt: new Date(),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: {},
    },
  });
}

export function resolveToolResponseUpdate(update: TurnStreamUpdate): TurnStreamUpdate {
  if (contentHasPendingResponses(update.content) || !isRequiresActionToolCalls(update.status)) {
    return update;
  }

  return { content: update.content };
}

function walkAssistantToolCallParts(
  content: readonly ThreadAssistantMessagePart[],
  visit: (part: AssistantToolCallPart) => void,
): void {
  for (const part of content) {
    if (part.type !== 'tool-call') {
      continue;
    }
    visit(part);
    if (part.messages == null) {
      continue;
    }
    for (const message of part.messages) {
      if (message.role === 'assistant') {
        walkAssistantToolCallParts(message.content, visit);
      }
    }
  }
}

function collectStagedResponsesFromContent(content: readonly ThreadAssistantMessagePart[]): Map<string, string> {
  const staged = new Map<string, string>();
  walkAssistantToolCallParts(content, part => {
    if (isStagedResponseAwaitingSdk(part)) {
      staged.set(part.toolCallId, String(part.result));
    }
  });
  return staged;
}

function applyStagedResponsesToContentMap(
  content: readonly ThreadAssistantMessagePart[],
  staged: ReadonlyMap<string, string>,
): ThreadAssistantMessagePart[] {
  return content.map(part => {
    if (part.type !== 'tool-call') {
      return part;
    }

    const contentValue = staged.get(part.toolCallId);
    let nextPart: AssistantToolCallPart = part;
    if (contentValue != null && hasPendingToolResponse(part)) {
      nextPart = applyToolResponseToToolCall(part, contentValue);
    }

    if (nextPart.messages == null) {
      return nextPart;
    }

    return {
      ...nextPart,
      messages: nextPart.messages.map(message => {
        if (message.role !== 'assistant') {
          return message;
        }
        return {
          ...message,
          content: applyStagedResponsesToContentMap(message.content, staged),
        };
      }),
    };
  });
}

export function mergeStagedResponsesIntoContent(
  incoming: readonly ThreadAssistantMessagePart[],
  existing: readonly ThreadAssistantMessagePart[],
): ThreadAssistantMessagePart[] {
  const staged = collectStagedResponsesFromContent(existing);
  if (staged.size === 0) {
    return [...incoming];
  }
  return applyStagedResponsesToContentMap(incoming, staged);
}

export function extractToolResponsesFromTurnInput(input: Turn['input'] | undefined): UserToolResponseInputEvent[] {
  const events: UserToolResponseInputEvent[] = [];
  for (const item of input ?? []) {
    if (item.type === EVENT_TYPE.USER_TOOL_RESPONSE) {
      events.push(item);
    }
  }
  return events;
}

export function applyUserToolResponsesToFold(fold: PeerThreadFoldState, inputs: readonly TurnInputItem[]): void {
  for (const item of inputs) {
    if (item.type === EVENT_TYPE.USER_TOOL_RESPONSE) {
      recordToolResponseInFold(fold, {
        toolCallId: item.toolCallId,
        content: item.content,
      });
    } else if (item.type === EVENT_TYPE.USER_TOOL_APPROVAL) {
      recordToolApprovalInFold(fold, {
        toolCallId: item.toolCallId,
        approved: item.approval.status === APPROVAL_DECISION_STATUS.ALLOW,
        ...(item.approval.status === APPROVAL_DECISION_STATUS.DENY && item.approval.reason != null
          ? { reason: item.approval.reason }
          : {}),
      });
    }
  }
}

export function collectSubsequentToolResponses(
  turns: readonly Pick<Turn, 'input'>[],
  fromIndex: number,
): Map<string, StoredToolResponse> {
  const responses = new Map<string, StoredToolResponse>();

  for (let index = fromIndex + 1; index < turns.length; index++) {
    const input = turns[index]?.input ?? [];
    if (input.some(item => item.type === EVENT_TYPE.USER_MESSAGE)) {
      break;
    }

    for (const event of extractToolResponsesFromTurnInput(input)) {
      responses.set(event.toolCallId, { content: event.content });
    }
  }

  return responses;
}

export function collectToolResponsesFromTurnInput(input: Turn['input'] | undefined): Map<string, StoredToolResponse> {
  const responses = new Map<string, StoredToolResponse>();
  for (const event of extractToolResponsesFromTurnInput(input)) {
    responses.set(event.toolCallId, { content: event.content });
  }
  return responses;
}

export function applyStagedResponsesToContent(
  content: readonly ThreadAssistantMessagePart[],
  responses: ReadonlyMap<string, StoredToolResponse>,
): ThreadAssistantMessagePart[] {
  const staged = new Map([...responses.entries()].map(([toolCallId, value]) => [toolCallId, value.content]));
  return applyStagedResponsesToContentMap(content, staged);
}
