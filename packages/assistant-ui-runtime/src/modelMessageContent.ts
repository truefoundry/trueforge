import type { ThreadAssistantMessagePart } from '@assistant-ui/core';
import type { PendingResponseRef } from './foldPeerThreads.js';
import { extractImagePartsFromModelMessage } from './modelMessageImageContent.js';
import type { ModelMessageEvent } from './server/index.js';

export type AssistantContentPart = ThreadAssistantMessagePart;

export interface ToolCallContext {
  toolResults?: ReadonlyMap<string, string>;
  pendingApprovals?: ReadonlyMap<string, { id: string }>;
  approvalDecisions?: ReadonlyMap<string, { id: string; approved: boolean; reason?: string }>;
  pendingResponses?: ReadonlyMap<string, PendingResponseRef>;
}

export type SdkToolCall = NonNullable<ModelMessageEvent['toolCalls']>[number];

type ToolCallPart = Extract<AssistantContentPart, { type: 'tool-call' }>;
type ToolCallArgValue = ToolCallPart['args'][string];

function isToolCallArgValue(value: unknown): value is ToolCallArgValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }
  if (typeof value === 'number') {
    return Number.isFinite(value);
  }
  if (Array.isArray(value)) {
    return value.every(isToolCallArgValue);
  }
  if (value != null && typeof value === 'object') {
    return Object.keys(value).every(key => isToolCallArgValue(Reflect.get(value, key)));
  }
  return false;
}

function parseToolArgs(argsText: string): ToolCallPart['args'] {
  if (!argsText) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(argsText);
    if (parsed != null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const entries: [string, ToolCallArgValue][] = [];
      for (const key of Object.keys(parsed)) {
        const value: unknown = Reflect.get(parsed, key);
        if (isToolCallArgValue(value)) {
          entries.push([key, value]);
        }
      }
      return Object.fromEntries(entries);
    }
    return {};
  } catch {
    return {};
  }
}

function toolCallToPart(toolCall: SdkToolCall, context?: ToolCallContext): ToolCallPart {
  const argsText = toolCall.function.arguments;
  const toolResult = context?.toolResults?.get(toolCall.id);
  const pendingResponse = context?.pendingResponses?.get(toolCall.id);
  const pendingApproval = context?.pendingApprovals?.get(toolCall.id);
  const approvalDecision = context?.approvalDecisions?.get(toolCall.id);

  let interrupt: ToolCallPart['interrupt'];
  if (pendingResponse != null && toolResult === undefined) {
    interrupt = {
      type: 'human',
      payload: {
        ...(pendingResponse.question != null ? { question: pendingResponse.question } : {}),
        ...(pendingResponse.options != null ? { options: pendingResponse.options } : {}),
      },
    };
  }

  let approval: ToolCallPart['approval'];
  if (approvalDecision != null) {
    approval = {
      id: approvalDecision.id,
      approved: approvalDecision.approved,
      ...(approvalDecision.reason != null ? { reason: approvalDecision.reason } : {}),
    };
  } else if (pendingApproval != null) {
    approval = { id: pendingApproval.id };
  }

  let result: ToolCallPart['result'];
  let isError = false;
  if (toolResult !== undefined) {
    result = toolResult;
  } else if (approvalDecision?.approved === false) {
    result = {
      error:
        approvalDecision.reason == null || approvalDecision.reason.length === 0
          ? 'Tool approval denied'
          : approvalDecision.reason,
    };
    isError = true;
  }

  return {
    type: 'tool-call',
    toolCallId: toolCall.id,
    toolName: toolCall.function.name,
    argsText,
    args: parseToolArgs(argsText),
    ...(result !== undefined ? { result } : {}),
    ...(isError ? { isError: true } : {}),
    ...(approval != null ? { approval } : {}),
    ...(interrupt != null ? { interrupt } : {}),
  };
}

function extractText(message: ModelMessageEvent): string {
  const { content, refusal } = message;
  if (content == null) {
    return refusal ?? '';
  }
  if (typeof content === 'string') {
    return content;
  }
  return content
    .map(part => {
      if (part.type === 'text') {
        return part.text;
      }
      if (part.type === 'refusal') {
        return part.refusal;
      }
      return '';
    })
    .join('');
}

export function buildAssistantContent(message: ModelMessageEvent, context?: ToolCallContext): AssistantContentPart[] {
  const parts: AssistantContentPart[] = [];
  if (message.reasoningContent) {
    parts.push({ type: 'reasoning', text: message.reasoningContent });
  }
  const text = extractText(message);
  if (text) {
    parts.push({ type: 'text', text });
  }
  parts.push(...extractImagePartsFromModelMessage(message));
  for (const toolCall of message.toolCalls ?? []) {
    parts.push(toolCallToPart(toolCall, context));
  }
  return parts;
}
