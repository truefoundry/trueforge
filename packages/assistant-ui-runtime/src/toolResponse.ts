import type {
  MessageStatus,
  ThreadAssistantMessage,
  ThreadAssistantMessagePart,
  ThreadMessage,
} from '@assistant-ui/core';
import type { ToolResponseRequiredEvent, Turn, TurnInputItem, UserToolResponseEvent } from './server/index.js';

import { ROOT_THREAD_ID } from './constants.js';
import { recordToolApprovalInFold, recordToolResponseInFold, type PeerThreadFoldState } from './foldPeerThreads.js';
import type { ToolResponseMessageCustomMetadata } from './messageCustomMetadata.js';
import type { TurnStreamUpdate } from './turnStreamUpdate.js';

export { ROOT_THREAD_ID } from './constants.js';

export const TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY = 'toolResponseThreadId';

export interface AskUserQuestionInterruptPayload {
  question?: string;
  options?: string[];
}

export type StoredToolResponse = Pick<UserToolResponseEvent, 'content'>;

export type RespondToToolResponseOptions = Pick<UserToolResponseEvent, 'toolCallId' | 'content'>;

type ToolCallPart = Extract<ThreadMessage['content'][number], { type: 'tool-call' }>;

type AssistantToolCallPart = Extract<ThreadAssistantMessagePart, { type: 'tool-call' }>;

export function hasPendingToolResponse(part: Pick<ToolCallPart, 'interrupt' | 'result'>): boolean {
  return part.interrupt != null && part.result === undefined;
}

function isStagedResponseAwaitingSdk(part: ToolCallPart): boolean {
  return part.interrupt != null && part.result !== undefined;
}

export function toolResponseStatus(): MessageStatus {
  return { type: 'requires-action', reason: 'tool-calls' };
}

export function toolResponseMessageCustom(threadId: string): ToolResponseMessageCustomMetadata {
  return {
    [TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY]: threadId === ROOT_THREAD_ID ? ROOT_THREAD_ID : threadId,
  };
}

export function getToolResponseThreadId(message: ThreadMessage | undefined): string | undefined {
  if (message?.role !== 'assistant') {
    return undefined;
  }
  const threadId = message.metadata.custom[TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY];
  return typeof threadId === 'string' ? threadId : undefined;
}

export function findResponseRequiredInTurn(turn: Pick<Turn, 'state'>): ToolResponseRequiredEvent | undefined {
  if (turn.state.status !== 'done') {
    return undefined;
  }
  const found = turn.state.requiredActions?.find(action => action.type === 'tool.response_required');
  return found?.type === 'tool.response_required' ? found : undefined;
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

function collectResponseInputsFromMessages(
  messages: readonly ThreadMessage[],
  defaultThreadId: string,
): UserToolResponseEvent[] {
  const events: UserToolResponseEvent[] = [];
  for (const message of messages) {
    events.push(...collectResponseInputs(message, defaultThreadId));
  }
  return events;
}

export function collectResponseInputs(message: ThreadMessage, threadId: string): UserToolResponseEvent[] {
  if (message.role !== 'assistant' || !threadId) {
    return [];
  }
  if (messageHasPendingResponses(message)) {
    return [];
  }

  const scopedThreadId = getToolResponseThreadId(message) ?? threadId;
  const events: UserToolResponseEvent[] = [];

  for (const part of message.content) {
    if (part.type !== 'tool-call') {
      continue;
    }
    if (isStagedResponseAwaitingSdk(part)) {
      events.push({
        type: 'user.tool_response',
        threadId: scopedThreadId,
        toolCallId: part.toolCallId,
        content: String(part.result),
      });
    }
    if (part.messages != null) {
      events.push(...collectResponseInputsFromMessages(part.messages, scopedThreadId));
    }
  }
  return events;
}

function contentHasPendingResponses(content: readonly ThreadAssistantMessagePart[]): boolean {
  return messageHasPendingResponses({
    id: 'pending-check',
    role: 'assistant',
    content,
    status: { type: 'complete', reason: 'stop' },
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
  if (
    contentHasPendingResponses(update.content) ||
    update.status?.type !== 'requires-action' ||
    update.status.reason !== 'tool-calls'
  ) {
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

export function extractToolResponsesFromTurnInput(input: Turn['input'] | undefined): UserToolResponseEvent[] {
  const events: UserToolResponseEvent[] = [];
  for (const item of input ?? []) {
    if (item.type === 'user.tool_response') {
      events.push(item);
    }
  }
  return events;
}

export function applyUserToolResponsesToFold(fold: PeerThreadFoldState, inputs: readonly TurnInputItem[]): void {
  for (const item of inputs) {
    if (item.type === 'user.tool_response') {
      recordToolResponseInFold(fold, {
        toolCallId: item.toolCallId,
        content: item.content,
      });
    } else if (item.type === 'user.tool_approval') {
      recordToolApprovalInFold(fold, {
        toolCallId: item.toolCallId,
        approved: item.approval.status === 'allow',
        ...(item.approval.status === 'deny' && item.approval.reason != null ? { reason: item.approval.reason } : {}),
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
    if (input.some(item => item.type === 'user.message')) {
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
