import type {
  MessageStatus,
  ThreadAssistantMessage,
  ThreadAssistantMessagePart,
  ThreadMessage,
} from '@assistant-ui/core';
import type { ToolApprovalRequiredEvent, Turn, UserToolApprovalEvent } from './server/index.js';

import { ROOT_THREAD_ID } from './constants.js';
import type { ToolApprovalMessageCustomMetadata } from './messageCustomMetadata.js';
import type { TurnStreamUpdate } from './turnStreamUpdate.js';

export { ROOT_THREAD_ID } from './constants.js';

export interface StoredApprovalDecision {
  approved: boolean;
  reason?: string;
}

export const TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY = 'toolApprovalThreadId';

export interface RespondToToolApprovalOptions {
  approvalId: string;
  approved: boolean;
  optionId?: string;
  reason?: string;
}

type ApprovalDecision = UserToolApprovalEvent['approval'];

type ToolCallPart = Extract<ThreadMessage['content'][number], { type: 'tool-call' }>;

type AssistantToolCallPart = Extract<ThreadAssistantMessagePart, { type: 'tool-call' }>;

export function hasPendingToolApproval(approval: ToolCallPart['approval'] | undefined): boolean {
  return approval != null && approval.approved === undefined && approval.resolution === undefined;
}

function applyApprovalDecisionToToolCall(
  part: AssistantToolCallPart,
  options: RespondToToolApprovalOptions,
): AssistantToolCallPart {
  const { approved, optionId, reason } = options;
  const targetApproval = part.approval;
  if (targetApproval == null) {
    return part;
  }
  const approval = {
    ...targetApproval,
    approved,
    ...(optionId != null ? { optionId } : {}),
    ...(reason != null ? { reason } : {}),
  };
  if (approved) {
    return { ...part, approval };
  }
  return {
    ...part,
    approval,
    result: { error: reason ?? 'Tool approval denied' },
    isError: true,
  };
}

function updateToolApprovalInContent(
  content: readonly ThreadAssistantMessagePart[],
  options: RespondToToolApprovalOptions,
): { content: readonly ThreadAssistantMessagePart[]; found: boolean } {
  let found = false;
  const newContent = content.map(part => {
    if (part.type !== 'tool-call') {
      return part;
    }

    if (part.approval?.id === options.approvalId) {
      found = true;
      return applyApprovalDecisionToToolCall(part, options);
    }

    if (part.messages == null) {
      return part;
    }

    const messages = part.messages.map(message => {
      if (message.role !== 'assistant') {
        return message;
      }
      const nested = updateToolApprovalInContent(message.content, options);
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

export function applyApprovalDecisionsToMessage(
  message: ThreadAssistantMessage,
  options: RespondToToolApprovalOptions,
): ThreadAssistantMessage {
  const { content } = updateToolApprovalInContent(message.content, options);
  return { ...message, content: [...content] };
}

export function toolApprovalStatus(): MessageStatus {
  return { type: 'requires-action', reason: 'tool-calls' };
}

export function toolApprovalMessageCustom(threadId: string): ToolApprovalMessageCustomMetadata {
  return {
    [TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY]: threadId === ROOT_THREAD_ID ? ROOT_THREAD_ID : threadId,
  };
}

export function getToolApprovalThreadId(message: ThreadMessage | undefined): string | undefined {
  if (message?.role !== 'assistant') {
    return undefined;
  }
  const threadId = message.metadata.custom[TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY];
  return typeof threadId === 'string' ? threadId : undefined;
}

export function findApprovalRequiredInTurn(turn: Pick<Turn, 'state'>): ToolApprovalRequiredEvent | undefined {
  if (turn.state.status !== 'done') {
    return undefined;
  }
  const found = turn.state.requiredActions?.find(action => action.type === 'tool.approval_required');
  return found?.type === 'tool.approval_required' ? found : undefined;
}

function toolCallPartHasPendingApproval(part: ToolCallPart): boolean {
  return hasPendingToolApproval(part.approval);
}

function nestedMessagesHavePendingApprovals(messages: readonly ThreadMessage[]): boolean {
  for (const message of messages) {
    if (messageHasPendingApprovals(message)) {
      return true;
    }
  }
  return false;
}

export function messageHasPendingApprovals(message: ThreadMessage | undefined): boolean {
  if (message?.role !== 'assistant') {
    return false;
  }
  for (const part of message.content) {
    if (part.type !== 'tool-call') {
      continue;
    }
    if (toolCallPartHasPendingApproval(part)) {
      return true;
    }
    if (part.messages != null && nestedMessagesHavePendingApprovals(part.messages)) {
      return true;
    }
  }
  return false;
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

export function collectDecidedApprovalsFromContent(
  content: readonly ThreadAssistantMessagePart[],
): Map<string, StoredApprovalDecision> {
  const decisions = new Map<string, StoredApprovalDecision>();
  walkAssistantToolCallParts(content, part => {
    const { approval } = part;
    if (approval?.id == null || approval.approved === undefined) {
      return;
    }
    decisions.set(approval.id, {
      approved: approval.approved,
      ...(approval.reason != null ? { reason: approval.reason } : {}),
    });
  });
  return decisions;
}

function applyApprovalDecisionsToMessages(
  messages: readonly ThreadMessage[],
  decisions: ReadonlyMap<string, StoredApprovalDecision>,
): ThreadMessage[] {
  return messages.map(message => {
    if (message.role !== 'assistant') {
      return message;
    }
    return {
      ...message,
      content: applyApprovalDecisionsToContent(message.content, decisions),
    };
  });
}

export function applyApprovalDecisionsToContent(
  content: readonly ThreadAssistantMessagePart[],
  decisions: ReadonlyMap<string, StoredApprovalDecision>,
): ThreadAssistantMessagePart[] {
  return content.map(part => {
    if (part.type !== 'tool-call') {
      return part;
    }

    const decision = part.approval?.id != null ? decisions.get(part.approval.id) : undefined;
    let nextPart: AssistantToolCallPart = part;

    if (decision != null && part.approval != null && part.approval.approved === undefined) {
      nextPart = applyApprovalDecisionToToolCall(part, {
        approvalId: part.approval.id,
        approved: decision.approved,
        ...(decision.reason == null ? {} : { reason: decision.reason }),
      });
    }

    if (nextPart.messages == null) {
      return nextPart;
    }

    return {
      ...nextPart,
      messages: applyApprovalDecisionsToMessages(nextPart.messages, decisions),
    };
  });
}

export function mergeDecidedApprovalsIntoContent(
  incoming: readonly ThreadAssistantMessagePart[],
  existing: readonly ThreadAssistantMessagePart[],
): ThreadAssistantMessagePart[] {
  const decided = collectDecidedApprovalsFromContent(existing);
  if (decided.size === 0) {
    return [...incoming];
  }
  return applyApprovalDecisionsToContent(incoming, decided);
}

export function extractToolApprovalsFromTurnInput(input: Turn['input'] | undefined): UserToolApprovalEvent[] {
  const events: UserToolApprovalEvent[] = [];
  for (const item of input ?? []) {
    if (item.type === 'user.tool_approval') {
      events.push(item);
    }
  }
  return events;
}

export function collectSubsequentApprovalDecisions(
  turns: readonly Pick<Turn, 'input'>[],
  fromIndex: number,
): Map<string, StoredApprovalDecision> {
  const decisions = new Map<string, StoredApprovalDecision>();

  for (let index = fromIndex + 1; index < turns.length; index++) {
    const input = turns[index]?.input ?? [];
    if (input.some(item => item.type === 'user.message')) {
      break;
    }

    for (const event of extractToolApprovalsFromTurnInput(input)) {
      decisions.set(event.toolCallId, {
        approved: event.approval.status === 'allow',
        ...(event.approval.status === 'deny' && event.approval.reason != null ? { reason: event.approval.reason } : {}),
      });
    }
  }

  return decisions;
}

export function collectApprovalDecisionsFromTurnInput(
  input: Turn['input'] | undefined,
): Map<string, StoredApprovalDecision> {
  const decisions = new Map<string, StoredApprovalDecision>();
  for (const event of extractToolApprovalsFromTurnInput(input)) {
    decisions.set(event.toolCallId, {
      approved: event.approval.status === 'allow',
      ...(event.approval.status === 'deny' && event.approval.reason != null ? { reason: event.approval.reason } : {}),
    });
  }
  return decisions;
}

function contentHasPendingApprovals(content: readonly ThreadAssistantMessagePart[]): boolean {
  return messageHasPendingApprovals({
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

export function resolveToolApprovalUpdate(
  update: TurnStreamUpdate,
  priorDecisions?: ReadonlyMap<string, StoredApprovalDecision>,
): TurnStreamUpdate {
  let { content } = update;
  if (priorDecisions != null && priorDecisions.size > 0) {
    content = applyApprovalDecisionsToContent(content, priorDecisions);
  }

  if (
    contentHasPendingApprovals(content) ||
    update.status?.type !== 'requires-action' ||
    update.status.reason !== 'tool-calls'
  ) {
    return { ...update, content };
  }

  return { content };
}

export function mapApprovalDecision(approved: boolean, reason?: string): ApprovalDecision {
  if (approved) {
    return { status: 'allow' };
  }
  return { status: 'deny', ...(reason != null ? { reason } : {}) };
}

function isDecidedApprovalAwaitingSdk(part: ToolCallPart): boolean {
  const { approval, result, isError } = part;
  if (approval?.id == null || approval.approved === undefined) {
    return false;
  }
  if (approval.approved) {
    return result === undefined;
  }
  return isError === true;
}

function collectApprovalInputsFromMessages(
  messages: readonly ThreadMessage[],
  defaultThreadId: string,
): UserToolApprovalEvent[] {
  const events: UserToolApprovalEvent[] = [];
  for (const message of messages) {
    events.push(...collectApprovalInputs(message, defaultThreadId));
  }
  return events;
}

export function collectApprovalInputs(message: ThreadMessage, threadId: string): UserToolApprovalEvent[] {
  if (message.role !== 'assistant' || !threadId) {
    return [];
  }
  if (messageHasPendingApprovals(message)) {
    return [];
  }

  const scopedThreadId = getToolApprovalThreadId(message) ?? threadId;
  const events: UserToolApprovalEvent[] = [];

  for (const part of message.content) {
    if (part.type !== 'tool-call') {
      continue;
    }
    if (isDecidedApprovalAwaitingSdk(part)) {
      const { approval } = part;
      if (approval?.approved === undefined) {
        continue;
      }
      events.push({
        type: 'user.tool_approval',
        threadId: scopedThreadId,
        toolCallId: approval.id,
        approval: mapApprovalDecision(approval.approved, approval.reason),
      });
    }
    if (part.messages != null) {
      events.push(...collectApprovalInputsFromMessages(part.messages, scopedThreadId));
    }
  }
  return events;
}

export function toTrueForgeApprovalInputs(
  message: Extract<ThreadMessage, { role: 'assistant' }>,
  response: RespondToToolApprovalOptions,
  defaultThreadId: string = ROOT_THREAD_ID,
): UserToolApprovalEvent[] {
  const updated = applyApprovalDecisionsToMessage(message, response);
  return collectApprovalInputs(updated, defaultThreadId);
}
