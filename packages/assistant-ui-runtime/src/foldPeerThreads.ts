import type { MessageStatus, ThreadMessage } from '@assistant-ui/core';
import {
  isEventDelta,
  type ThreadContextCompactionFinishedEvent,
  type ThreadContextCompactionStartedEvent,
  type ThreadCreatedEvent,
  type ToolResponseRequiredEvent,
  type TurnEvent,
  type TurnStreamingEvent,
} from './server/index.js';

import { parseAskUserQuestionArgs } from './askUserQuestion.js';
import { ROOT_THREAD_ID } from './constants.js';
import { CONTEXT_COMPACTION_DATA_NAME, type ContextCompactionPartData } from './contextCompaction.js';
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
  /** Failure text from a sub-agent thread that ended in error. */
  error?: string;
  title?: string;
  agentInfo?: AgentInfo;
}

/**
 * Sticky note on the fold while projecting a finished parent turn.
 * Unfinished children copy this so they show cancelled/error instead of running.
 */
export type ParentTerminalStatus = 'cancelled' | 'error';

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
    `[@truefoundry/trueforge-assistant-ui-runtime] Expected root thread "${ROOT_THREAD_ID}" but received "${threadId}" on ${eventType}.`,
  );
}

function assertRootThreadEvent(threadId: string, eventType: string): void {
  if (threadId === ROOT_THREAD_ID) {
    return;
  }
  if (isDev) {
    throw new Error(
      `[@truefoundry/trueforge-assistant-ui-runtime] Root-looking event ${eventType} arrived on thread "${threadId}" instead of "${ROOT_THREAD_ID}".`,
    );
  }
  warnUnexpectedRootThread(threadId, eventType);
}

export class PeerThreadFoldState {
  readonly threads = new Map<string, ThreadBucket>();
  readonly threadParents = new Map<string, ThreadParentLink>();
  /** Set only while building content for a cancelled/errored parent turn; cleared after. */
  parentTerminalStatus: ParentTerminalStatus | undefined;
  /** Set only while building a finished turn; later compactions belong to a newer turn. */
  settledTurnCompletedAtMs: number | undefined;

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

/** Pull the human-readable error off a thread.done error state, or a fallback label. */
function threadDoneErrorMessage(state: unknown): string | undefined {
  if (typeof state !== 'object' || state == null) {
    return undefined;
  }
  if (!('status' in state) || state.status !== 'error') {
    return undefined;
  }
  if (!('error' in state)) {
    return 'Sub-agent failed';
  }
  const error = state.error;
  return typeof error === 'string' && error.length > 0 ? error : 'Sub-agent failed';
}

/**
 * Cancel often leaves a noisy "LLM stream aborted" error on the child thread.
 * That is cancel cleanup, not a real sub-agent failure.
 */
export function isAbortShapedThreadError(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    normalized === 'llm stream aborted' ||
    normalized === 'aborterror' ||
    normalized.includes('stream aborted') ||
    normalized.includes('aborterror')
  );
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
    // Remember the failure message so the UI can show error instead of complete.
    const errorMessage = threadDoneErrorMessage(message.state);
    if (errorMessage != null) {
      bucket.error = errorMessage;
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
    message.type === 'tool.response_required' ||
    message.type === 'thread.context_compaction_started' ||
    message.type === 'thread.context_compaction_finished'
  );
}

/**
 * Events in emission-time order. Event ids are allocated before the work runs (a
 * model.message id precedes the compaction that runs before it), so insertion
 * order can disagree with `createdAt`; pairing and placement must follow time.
 */
function eventsInTimeOrder(bucket: ThreadBucket): [string, TurnEvent][] {
  return [...bucket.events].sort(([, a], [, b]) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Next model.message id after `fromId` in insertion order, if any. */
function nextModelMessageIdAfter({ bucket, fromId }: { bucket: ThreadBucket; fromId: string }): string | undefined {
  let passed = false;
  for (const [id, event] of eventsInTimeOrder(bucket)) {
    if (!passed) {
      if (id === fromId) {
        passed = true;
      }
      continue;
    }
    if (event.type === 'model.message') {
      return id;
    }
  }
  return undefined;
}

/** Last model.message id before `beforeId` in insertion order, if any. */
function previousModelMessageIdBefore({
  bucket,
  beforeId,
}: {
  bucket: ThreadBucket;
  beforeId: string;
}): string | undefined {
  let previous: string | undefined;
  for (const [id, event] of eventsInTimeOrder(bucket)) {
    if (id === beforeId) {
      return previous;
    }
    if (event.type === 'model.message') {
      previous = id;
    }
  }
  return previous;
}

/**
 * Compaction started events belonging to a model-message scope.
 *
 * A started event pairs with the next model.message after it. When that model
 * message is in scope, include the compaction. When there is no following model
 * message yet, it is the live tip: include for an empty scope, or when the
 * scope holds the model message right before it (mid-turn compaction).
 */
function shouldIncludeCompactionStarted({
  bucket,
  startedId,
  scopedModelIds,
  settledTurnCompletedAtMs,
}: {
  bucket: ThreadBucket;
  startedId: string;
  scopedModelIds: ReadonlySet<string> | null;
  settledTurnCompletedAtMs: number | undefined;
}): boolean {
  if (scopedModelIds == null) {
    return true;
  }
  const nextModelId = nextModelMessageIdAfter({ bucket, fromId: startedId });
  if (nextModelId != null) {
    return scopedModelIds.has(nextModelId);
  }
  // The fold is session-wide: a compaction that began after this turn finished is the next turn's.
  const startedAtMs = Date.parse(bucket.events.get(startedId)?.createdAt ?? '');
  if (settledTurnCompletedAtMs != null && startedAtMs > settledTurnCompletedAtMs) {
    return false;
  }
  if (scopedModelIds.size === 0) {
    return true;
  }
  const previousModelId = previousModelMessageIdBefore({ bucket, beforeId: startedId });
  return previousModelId != null && scopedModelIds.has(previousModelId);
}

function findFinishedForStarted({
  bucket,
  startedId,
}: {
  bucket: ThreadBucket;
  startedId: string;
}): ThreadContextCompactionFinishedEvent | undefined {
  let passed = false;
  for (const [id, event] of eventsInTimeOrder(bucket)) {
    if (!passed) {
      if (id === startedId) {
        passed = true;
      }
      continue;
    }
    if (event.type === 'thread.context_compaction_started') {
      return undefined;
    }
    if (event.type === 'thread.context_compaction_finished') {
      return event;
    }
  }
  return undefined;
}

/**
 * Unfinished compaction (started, no finished) stays `running` only while the
 * thread/turn is still live. Terminal parent/bucket state mirrors
 * `bucketAssistantStatus` so cancel/error does not leave a stuck spinner.
 */
function compactionPartDataFromStarted({
  bucket,
  state,
  started,
}: {
  bucket: ThreadBucket;
  state: PeerThreadFoldState;
  started: ThreadContextCompactionStartedEvent;
}): ContextCompactionPartData {
  const finished = findFinishedForStarted({ bucket, startedId: started.id });
  if (finished != null) {
    return { status: 'complete', started, finished };
  }

  if (state.parentTerminalStatus === 'cancelled') {
    if (!bucket.done || (bucket.error != null && isAbortShapedThreadError(bucket.error))) {
      return { status: 'incomplete', reason: 'cancelled', started };
    }
  }
  if (bucket.error != null) {
    return { status: 'incomplete', reason: 'error', started };
  }
  if (!bucket.done && state.parentTerminalStatus === 'error') {
    return { status: 'incomplete', reason: 'error', started };
  }
  return { status: 'running', started };
}

function compactionPartFromStarted({
  bucket,
  state,
  started,
}: {
  bucket: ThreadBucket;
  state: PeerThreadFoldState;
  started: ThreadContextCompactionStartedEvent;
}): Extract<AssistantContentPart, { type: 'data' }> {
  return {
    type: 'data',
    name: CONTEXT_COMPACTION_DATA_NAME,
    data: compactionPartDataFromStarted({ bucket, state, started }),
  };
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

function bucketAssistantStatus(bucket: ThreadBucket, state: PeerThreadFoldState): MessageStatus {
  if (bucket.pendingApprovals.size > 0) {
    return toolApprovalStatus();
  }
  if (bucketHasUnresolvedPendingResponses(bucket)) {
    return toolResponseStatus();
  }
  // Parent was cancelled: unfinished (or abort-noise) children count as cancelled too.
  if (state.parentTerminalStatus === 'cancelled') {
    if (!bucket.done || (bucket.error != null && isAbortShapedThreadError(bucket.error))) {
      return { type: 'incomplete', reason: 'cancelled' };
    }
  }
  // Real sub-agent failure (not abort noise from a cancel).
  if (bucket.error != null) {
    return { type: 'incomplete', reason: 'error', error: bucket.error };
  }
  if (!bucket.done) {
    // Parent already failed; child never finished — show parent failure, not "running".
    if (state.parentTerminalStatus === 'error') {
      return { type: 'incomplete', reason: 'error', error: 'Parent turn failed' };
    }
    if (bucket.modelMessageIds.length > 0) {
      return { type: 'running' };
    }
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

  const scopedModelIds = threadId === ROOT_THREAD_ID && modelMessageIds != null ? new Set(modelMessageIds) : null;
  const modelIdSet = new Set(
    threadId === ROOT_THREAD_ID && modelMessageIds != null ? modelMessageIds : bucket.modelMessageIds,
  );

  const parts: AssistantContentPart[] = [];
  // A single tool call can appear in more than one `model.message` event (e.g.
  // once in the paused turn and again in the resumed turn after a tool
  // approval). assistant-ui keys tool parts by `toolCallId` within a message,
  // so emitting the same id twice crashes the render. Collapse duplicates,
  // letting the latest occurrence win while preserving the original position.
  const toolCallIndexById = new Map<string, number>();

  // Walk insertion order so compaction steps sit before the model message they
  // prepare for (PreLLM). Scoped builds still filter via model-message pairing.
  for (const [id, event] of eventsInTimeOrder(bucket)) {
    if (event.type === 'thread.context_compaction_started') {
      if (
        !shouldIncludeCompactionStarted({
          bucket,
          startedId: id,
          scopedModelIds,
          settledTurnCompletedAtMs: state.settledTurnCompletedAtMs,
        })
      ) {
        continue;
      }
      parts.push(compactionPartFromStarted({ bucket, state, started: event }));
      continue;
    }

    if (event.type !== 'model.message' || !modelIdSet.has(id)) {
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
      status: bucketAssistantStatus(bucket, state),
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
