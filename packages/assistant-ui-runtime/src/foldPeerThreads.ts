import type { MessageStatus, ThreadMessage } from '@assistant-ui/core';
import {
  isEventDelta,
  type ThreadCreatedEvent,
  type ToolResponseRequiredEvent,
  type TurnEvent,
  type TurnStreamingEvent,
} from './server/index.js';

import { parseAskUserQuestionArgs } from './askUserQuestion.js';
import { ROOT_THREAD_ID } from './constants.js';
import { isCreateSubAgentToolCall } from './createSubAgent.js';
import type { SubAgentMessageCustomMetadata } from './messageCustomMetadata.js';
import { buildAssistantContent, type AssistantContentPart, type SdkToolCall } from './modelMessageContent.js';
import { mergeStreamEventDelta } from './modelMessageImageContent.js';
import { toolApprovalMessageCustom, toolApprovalStatus } from './toolApproval.js';
import { toolResponseMessageCustom, toolResponseStatus } from './toolResponse.js';

export { ROOT_THREAD_ID } from './constants.js';

type AgentInfo = ThreadCreatedEvent['agentInfo'];

export interface SubAgentCustomMetadata {
  threadId: string;
  title?: string;
  name?: string;
  model?: string;
  input?: string;
}

export interface SubAgentArtifact {
  subAgents: {
    threadId: string;
    title?: string;
    agentInfo?: AgentInfo;
  }[];
}

type ToolCallRef = ToolResponseRequiredEvent['toolCalls'][number];

export interface PendingResponseRef {
  id: string;
  sourceEventId: string;
  question?: string;
  options?: string[];
}

export interface ApprovalDecisionRef {
  id: string;
  approved: boolean;
  reason?: string;
}

export interface ThreadBucket {
  events: Map<string, TurnEvent>;
  modelMessageIds: string[];
  toolResults: Map<string, string>;
  pendingApprovals: Map<string, { id: string }>;
  approvalDecisions: Map<string, ApprovalDecisionRef>;
  pendingResponses: Map<string, PendingResponseRef>;
  done: boolean;
  title?: string;
  agentInfo?: AgentInfo;
}

export interface ThreadParentLink {
  parentThreadId: string;
  toolCallId: string;
}

const isDev =
  typeof process !== 'undefined' && typeof process.env !== 'undefined' && process.env['NODE_ENV'] !== 'production';

function warnUnexpectedRootThread(threadId: string, eventType: string): void {
  if (!isDev) {
    return;
  }
  console.warn(
    `[@truefoundry/assistant-ui-runtime] Expected root thread "${ROOT_THREAD_ID}" but received "${threadId}" on ${eventType}.`,
  );
}

function assertRootThreadEvent(threadId: string, eventType: string): void {
  if (threadId === ROOT_THREAD_ID) {
    return;
  }
  if (isDev) {
    throw new Error(
      `[@truefoundry/assistant-ui-runtime] Root-looking event ${eventType} arrived on thread "${threadId}" instead of "${ROOT_THREAD_ID}".`,
    );
  }
  warnUnexpectedRootThread(threadId, eventType);
}

export class PeerThreadFoldState {
  readonly threads = new Map<string, ThreadBucket>();
  readonly threadParents = new Map<string, ThreadParentLink>();

  getOrCreateBucket(threadId: string): ThreadBucket {
    let bucket = this.threads.get(threadId);
    if (bucket == null) {
      bucket = {
        events: new Map(),
        modelMessageIds: [],
        toolResults: new Map(),
        pendingApprovals: new Map(),
        approvalDecisions: new Map(),
        pendingResponses: new Map(),
        done: false,
      };
      this.threads.set(threadId, bucket);
    }
    return bucket;
  }
}

function isTurnScopedEvent(
  message: TurnStreamingEvent,
): message is Extract<TurnStreamingEvent, { type: 'turn.created' | 'turn.done' }> {
  return message.type === 'turn.created' || message.type === 'turn.done';
}

function ingestEventIntoBucket(bucket: ThreadBucket, message: TurnStreamingEvent): void {
  if (isTurnScopedEvent(message)) {
    return;
  }

  if (isEventDelta(message)) {
    const base = bucket.events.get(message.id);
    if (base != null) {
      mergeStreamEventDelta(base, message);
    }
    return;
  }

  bucket.events.set(message.id, message);

  if (message.type === 'model.message') {
    if (!bucket.modelMessageIds.includes(message.id)) {
      bucket.modelMessageIds.push(message.id);
    }
    return;
  }

  if (message.type === 'tool.response') {
    bucket.toolResults.set(message.toolCallId, message.content);
    bucket.pendingResponses.delete(message.toolCallId);
    return;
  }

  if (message.type === 'tool.approval_required') {
    for (const ref of message.toolCalls) {
      bucket.pendingApprovals.set(ref.id, { id: ref.id });
    }
    return;
  }

  if (message.type === 'tool.response_required') {
    for (const ref of message.toolCalls) {
      const resolved = resolveAskUserQuestionFromBucket(bucket, ref);
      bucket.pendingResponses.set(ref.id, {
        id: ref.id,
        sourceEventId: ref.sourceEventId,
        ...(resolved?.question != null ? { question: resolved.question } : {}),
        ...(resolved?.options != null ? { options: resolved.options } : {}),
      });
    }
    return;
  }

  if (message.type === 'thread.done') {
    bucket.done = true;
    if (message.title) {
      bucket.title = message.title;
    }
  }
}

function isContentAffectingEvent(message: TurnStreamingEvent): boolean {
  return (
    message.type === 'thread.created' ||
    message.type === 'thread.done' ||
    message.type === 'model.message' ||
    message.type === 'model.message.delta' ||
    message.type === 'tool.response' ||
    message.type === 'tool.approval_required' ||
    message.type === 'tool.response_required'
  );
}

export function ingestStreamEvent(state: PeerThreadFoldState, message: TurnStreamingEvent): boolean {
  if (message.type === 'mcp.auth_required' || isTurnScopedEvent(message)) {
    return false;
  }

  if (message.threadId == null) {
    return false;
  }

  if (message.type === 'thread.created') {
    state.threadParents.set(message.threadId, {
      parentThreadId: message.parent.threadId,
      toolCallId: message.parent.toolCallId,
    });
    const bucket = state.getOrCreateBucket(message.threadId);
    bucket.title = message.title;
    bucket.agentInfo = message.agentInfo;
    return true;
  }

  if (message.type === 'model.message' && message.threadId === ROOT_THREAD_ID) {
    assertRootThreadEvent(message.threadId, message.type);
  }

  const bucket = state.getOrCreateBucket(message.threadId);
  ingestEventIntoBucket(bucket, message);

  return isContentAffectingEvent(message);
}

export function ingestTurnEvent(state: PeerThreadFoldState, event: TurnEvent): void {
  if (event.threadId == null) {
    return;
  }

  if (event.type === 'thread.created') {
    state.threadParents.set(event.threadId, {
      parentThreadId: event.parent.threadId,
      toolCallId: event.parent.toolCallId,
    });
    const bucket = state.getOrCreateBucket(event.threadId);
    bucket.title = event.title;
    bucket.agentInfo = event.agentInfo;
  } else if (event.type === 'model.message' && event.threadId === ROOT_THREAD_ID) {
    assertRootThreadEvent(event.threadId, event.type);
  }

  ingestEventIntoBucket(state.getOrCreateBucket(event.threadId), event);
}

function resolveAskUserQuestionFromBucket(
  bucket: ThreadBucket,
  ref: Pick<ToolCallRef, 'id' | 'sourceEventId'>,
): { question?: string; options?: string[] } | undefined {
  const modelMessage = bucket.events.get(ref.sourceEventId);
  if (modelMessage?.type !== 'model.message') {
    return undefined;
  }
  const toolCall = modelMessage.toolCalls?.find(call => call.id === ref.id);
  if (toolCall == null) {
    return undefined;
  }
  return parseAskUserQuestionArgs(toolCall.function.arguments);
}

function findToolCallInBucket(bucket: ThreadBucket, toolCallId: string): SdkToolCall | undefined {
  for (const id of bucket.modelMessageIds) {
    const event = bucket.events.get(id);
    if (event?.type !== 'model.message') {
      continue;
    }
    const match = event.toolCalls?.find(toolCall => toolCall.id === toolCallId);
    if (match != null) {
      return match;
    }
  }
  return undefined;
}

function isLinkedCreateSubAgentThread(state: PeerThreadFoldState, subThreadId: string): boolean {
  const link = state.threadParents.get(subThreadId);
  if (link == null) {
    return false;
  }
  const parentBucket = state.threads.get(link.parentThreadId);
  if (parentBucket == null) {
    return false;
  }
  const toolCall = findToolCallInBucket(parentBucket, link.toolCallId);
  return toolCall != null && isCreateSubAgentToolCall(toolCall);
}

function childSubThreadIds(state: PeerThreadFoldState, parentThreadId: string, toolCallId: string): string[] {
  const ids: string[] = [];
  for (const [subThreadId, link] of state.threadParents) {
    if (
      link.parentThreadId === parentThreadId &&
      link.toolCallId === toolCallId &&
      isLinkedCreateSubAgentThread(state, subThreadId)
    ) {
      ids.push(subThreadId);
    }
  }
  return ids;
}

function bucketHasUnresolvedPendingResponses(bucket: ThreadBucket): boolean {
  for (const id of bucket.pendingResponses.keys()) {
    if (!bucket.toolResults.has(id)) {
      return true;
    }
  }
  return false;
}

function bucketAssistantStatus(bucket: ThreadBucket): MessageStatus {
  if (bucket.pendingApprovals.size > 0) {
    return toolApprovalStatus();
  }
  if (bucketHasUnresolvedPendingResponses(bucket)) {
    return toolResponseStatus();
  }
  if (!bucket.done && bucket.modelMessageIds.length > 0) {
    return { type: 'running' };
  }
  return { type: 'complete', reason: 'stop' };
}

function buildSubAgentCustomMetadata(threadId: string, bucket: ThreadBucket): SubAgentMessageCustomMetadata {
  const metadata: SubAgentCustomMetadata = {
    threadId,
    ...(bucket.title != null ? { title: bucket.title } : {}),
    ...(bucket.agentInfo?.name != null ? { name: bucket.agentInfo.name } : {}),
    ...(bucket.agentInfo?.model != null ? { model: bucket.agentInfo.model } : {}),
    ...(bucket.agentInfo?.input != null ? { input: bucket.agentInfo.input } : {}),
  };
  return { subAgent: metadata };
}

function attachSubAgentMessages(
  state: PeerThreadFoldState,
  parentThreadId: string,
  parts: AssistantContentPart[],
): AssistantContentPart[] {
  const parentBucket = state.threads.get(parentThreadId);

  return parts.map(part => {
    if (part.type !== 'tool-call' || parentBucket == null) {
      return part;
    }

    const sdkToolCall = findToolCallInBucket(parentBucket, part.toolCallId);
    if (sdkToolCall == null || !isCreateSubAgentToolCall(sdkToolCall)) {
      return part;
    }

    const childIds = childSubThreadIds(state, parentThreadId, part.toolCallId);
    if (childIds.length === 0) {
      return part;
    }

    const messages: ThreadMessage[] = [];
    const subAgents: SubAgentArtifact['subAgents'] = [];
    for (const childId of childIds) {
      const childMessages = buildSubThreadMessages(state, childId);
      if (childMessages.length > 0) {
        messages.push(...childMessages);
      }
      const childBucket = state.threads.get(childId);
      if (childBucket != null) {
        subAgents.push({
          threadId: childId,
          ...(childBucket.title != null ? { title: childBucket.title } : {}),
          ...(childBucket.agentInfo != null ? { agentInfo: childBucket.agentInfo } : {}),
        });
      }
    }
    if (messages.length === 0 && subAgents.length === 0) {
      return part;
    }

    const artifact: SubAgentArtifact = { subAgents };
    // thread.created (title, agentInfo) arrives before the child's first model.message.
    // Attach artifact-only so UI can render the sub-agent header immediately; see README
    // SubAgentArtifact / MessagePartPrimitive.Messages in agent-ui ToolCallContainer.
    if (messages.length === 0) {
      return { ...part, artifact };
    }
    return { ...part, messages, artifact };
  });
}

function buildThreadAssistantParts(
  state: PeerThreadFoldState,
  threadId: string,
  modelMessageIds?: readonly string[],
): AssistantContentPart[] {
  const bucket = state.threads.get(threadId);
  if (bucket == null) {
    return [];
  }

  const ids = threadId === ROOT_THREAD_ID && modelMessageIds != null ? modelMessageIds : bucket.modelMessageIds;

  const parts: AssistantContentPart[] = [];
  // A single tool call can appear in more than one `model.message` event (e.g.
  // once in the paused turn and again in the resumed turn after a tool
  // approval). assistant-ui keys tool parts by `toolCallId` within a message,
  // so emitting the same id twice crashes the render. Collapse duplicates,
  // letting the latest occurrence win while preserving the original position.
  const toolCallIndexById = new Map<string, number>();
  for (const id of ids) {
    const event = bucket.events.get(id);
    if (event?.type !== 'model.message') {
      continue;
    }
    for (const part of buildAssistantContent(event, {
      toolResults: bucket.toolResults,
      pendingApprovals: bucket.pendingApprovals,
      approvalDecisions: bucket.approvalDecisions,
      pendingResponses: bucket.pendingResponses,
    })) {
      if (part.type === 'tool-call') {
        const existingIndex = toolCallIndexById.get(part.toolCallId);
        if (existingIndex != null) {
          parts[existingIndex] = part;
          continue;
        }
        toolCallIndexById.set(part.toolCallId, parts.length);
      }
      parts.push(part);
    }
  }

  return attachSubAgentMessages(state, threadId, parts);
}

function buildSubThreadMessages(state: PeerThreadFoldState, threadId: string): ThreadMessage[] {
  const bucket = state.threads.get(threadId);
  if (bucket == null) {
    return [];
  }

  const content = buildThreadAssistantParts(state, threadId);
  if (content.length === 0) {
    return [];
  }

  const custom = {
    ...buildSubAgentCustomMetadata(threadId, bucket),
    ...(bucket.pendingApprovals.size > 0 ? toolApprovalMessageCustom(threadId) : {}),
    ...(bucketHasUnresolvedPendingResponses(bucket) ? toolResponseMessageCustom(threadId) : {}),
  };

  return [
    {
      id: `${threadId}-assistant`,
      role: 'assistant',
      content,
      status: bucketAssistantStatus(bucket),
      createdAt: new Date(),
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom,
      },
    },
  ];
}

export function buildRootAssistantContent(state: PeerThreadFoldState): AssistantContentPart[] {
  return buildThreadAssistantParts(state, ROOT_THREAD_ID);
}

export function buildRootAssistantContentForIds(
  state: PeerThreadFoldState,
  modelMessageIds: readonly string[],
): AssistantContentPart[] {
  return buildThreadAssistantParts(state, ROOT_THREAD_ID, modelMessageIds);
}

export function findFirstPendingApprovalThreadId(state: PeerThreadFoldState): string | undefined {
  for (const [threadId, bucket] of state.threads) {
    if (bucket.pendingApprovals.size > 0) {
      return threadId;
    }
  }
  return undefined;
}

export function findFirstPendingResponseThreadId(state: PeerThreadFoldState): string | undefined {
  for (const [threadId, bucket] of state.threads) {
    if (bucketHasUnresolvedPendingResponses(bucket)) {
      return threadId;
    }
  }
  return undefined;
}

export function resolveAskUserQuestion(
  state: PeerThreadFoldState,
  threadId: string,
  ref: Pick<ToolCallRef, 'id' | 'sourceEventId'>,
): { question?: string; options?: string[] } | undefined {
  const bucket = state.threads.get(threadId);
  if (bucket == null) {
    return undefined;
  }
  return resolveAskUserQuestionFromBucket(bucket, ref);
}

export function isRootThreadId(threadId: string | undefined): boolean {
  return threadId === ROOT_THREAD_ID;
}

export function recordToolApprovalInFold(
  fold: PeerThreadFoldState,
  decision: { toolCallId: string; approved: boolean; reason?: string },
): void {
  const record: ApprovalDecisionRef = {
    id: decision.toolCallId,
    approved: decision.approved,
    ...(decision.reason != null ? { reason: decision.reason } : {}),
  };
  let applied = false;
  for (const bucket of fold.threads.values()) {
    if (!bucket.pendingApprovals.has(decision.toolCallId)) {
      continue;
    }
    bucket.pendingApprovals.delete(decision.toolCallId);
    bucket.approvalDecisions.set(decision.toolCallId, record);
    applied = true;
  }
  if (applied) {
    return;
  }
  const rootBucket = fold.getOrCreateBucket(ROOT_THREAD_ID);
  rootBucket.approvalDecisions.set(decision.toolCallId, record);
}

/** Persist a user.tool_response answer into fold state (clears pending ask-user). */
export function recordToolResponseInFold(
  fold: PeerThreadFoldState,
  response: { toolCallId: string; content: string },
): void {
  let applied = false;
  for (const bucket of fold.threads.values()) {
    if (!bucket.pendingResponses.has(response.toolCallId)) {
      continue;
    }
    bucket.toolResults.set(response.toolCallId, response.content);
    bucket.pendingResponses.delete(response.toolCallId);
    applied = true;
  }
  if (applied) {
    return;
  }
  const rootBucket = fold.getOrCreateBucket(ROOT_THREAD_ID);
  rootBucket.toolResults.set(response.toolCallId, response.content);
  rootBucket.pendingResponses.delete(response.toolCallId);
}
