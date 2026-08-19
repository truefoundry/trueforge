import type { ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat';
import type { Logger } from 'winston';
import type { AgentCapability, CapabilityState } from '../capabilities/AgentCapability';
import type {
  AgentContextProcessorOutput,
  AgentContextProcessorOverwriteContext,
  AgentThreadExecutionContext,
  PostToolCallAgentContextProcessor,
  PreLLMAgentContextProcessor,
  PreLLMEphemeralAgentContextProcessor,
  PreSendContextProcessor,
} from '../capabilities/AgentContextProcessor';
import { SUB_AGENT_IDENTITY } from '../capabilities/builtins/DynamicSubAgents';
import type { ToolResponseProcessor } from '../capabilities/ToolResponseProcessor';
import { AgentHarnessError, InvalidAgentSendInputError } from '../errors';
import type { RegisteredPassthroughEvent } from '../events/PassthroughEvents';
import {
  EventType,
  newEventId,
  type AgentApprovalDecisionMessage,
  type AgentInfo,
  type AgentOutputEvent,
  type AgentParent,
  type MCPInitializeEvent,
  type MCPServerInitInfo,
  type ModelMessageDeltaEvent,
  type ModelMessageEvent,
  type ModelMessageUsage,
  type SandboxCreatedEvent,
  type ThreadOverwriteContextEvent,
  type ToolApprovalRequiredEvent,
  type ToolResponseEvent,
  type ToolResponseRequiredEvent,
  type UserToolApprovalMessage,
  type UserToolResponseMessage,
} from '../events/schema';
import { InstructionBuilder, ROOT_AGENT_IDENTITY } from '../InstructionBuilder';
import type { LLMCreateParamsStreaming } from '../llm/ILLM';
import {
  type CompletionUsage,
  type ExtendedChatCompletionChunk,
  type FinishReason,
  type InternalEnrichedAssistantMessage,
  type InternalEnrichedToolCall,
  type LLMToolMessage,
  type LLMUserMessage,
  type RawAssistantMessage,
} from '../llm/LLMTypes';
import { toOpenAIResponseFormat } from '../llm/responseFormat';
import { toOpenAIChatMessage } from '../llm/toOpenAIChatMessage';
import { estimateTokensForString } from '../llm/usage';
import { convertMCPServersToTools, type ConvertToolsResult, type MappedMCPTool } from '../mcp/convertMCPServers';
import { executeToolCalls } from '../mcp/executeToolCalls';
import type { IToolSet, MCPAuthRequired } from '../mcp/IMCPServer';
import type { Sandbox, SandboxInfo } from '../sandbox/Sandbox';
import type { AgentTracing } from '../tracing/AgentTracing';
import { describeUnknownError, extractErrorLogFields } from '../util/errorLogFields';
import type { AgentDefinition } from './AgentDefinition';
import type {
  AgentThreadConstructorInput,
  AgentThreadRuntimeSendBatch,
  AgentThreadRuntimeSendInput,
  AgentThreadSnapshot,
} from './AgentThread.types';
import {
  InternalEventType,
  type AgentThreadAppendContext,
  type AgentThreadEvent,
  type ContextMessage,
  type InternalCapabilityStateEvent,
  type InternalMCPAuthRequiredEvent,
  type InternalThreadDoneEvent,
  type SubAgentCompletionMarker,
} from './AgentThread.types';
import {
  currentContextUsageFromCompletion,
  getEmptyCurrentContextUsage,
  mergeCurrentContextUsage,
  type CurrentContextUsage,
} from './contextUsage';
import {
  assistantMessageContentToStringForSubAgent,
  estimateTokensForContextMessages,
  INTERNAL_SYSTEM_PROMPT,
  isApprovalDecisionMessage,
  isClientSideToolResponseMessage,
  isInputUserMessage,
  isLLMContextMessage,
  isLLMToolMessage,
  makeUnknownToolInfo,
  scanApprovalDecisions,
  toEnrichedToolCall,
  toToolCallInfo,
} from './contextUtils';
import { DeferredTool } from './DeferredTool';
import { createEmptyAgentThreadMetrics, updateMetricsFromUsage, type AgentThreadMetrics } from './metrics';
import { getClosableOpenToolCallIds, OpenToolCallCloser } from './OpenToolCallCloser';
import { isEmptyMessageContent, processAgentUserInput, type AgentInputUserMessage } from './UserInputMessage';

const DEFAULT_ITERATION_LIMIT = 25;

type AgentThreadState = 'llm-call-required' | 'tool-response-required' | 'user-input-required';

type StepOutcome = 'exit' | 'continue';

const VALID_TRANSITIONS: Record<AgentThreadState, AgentThreadState[]> = {
  'llm-call-required': ['tool-response-required', 'user-input-required'],
  'tool-response-required': ['llm-call-required'],
  // user-input-required transitions to:
  //   tool-response-required — after approval decisions are appended (approval flow)
  //   llm-call-required     — after client-side tool responses resolve tool calls directly
  'user-input-required': ['tool-response-required', 'llm-call-required'],
};

function assertValidTransition(from: AgentThreadState, to: AgentThreadState): void {
  if (!VALID_TRANSITIONS[from].includes(to)) {
    throw new Error(`Invalid state transition: ${from} → ${to}`);
  }
}

function deriveAgentThreadState(context: ContextMessage[]): AgentThreadState {
  const openToolCallIds = getOpenToolCallIds(context);
  if (openToolCallIds.size === 0) {
    return 'llm-call-required';
  }

  const assistant = lastAssistantInContext(context);
  const decisions = scanApprovalDecisions(context);
  const hasPendingApproval = assistant?.tool_calls?.some(
    tc => openToolCallIds.has(tc.id) && tc.tool_info.is_approval_required === true && !decisions.has(tc.id),
  );
  const hasPendingClientSideTool = assistant?.tool_calls?.some(
    tc => openToolCallIds.has(tc.id) && tc.tool_info.is_client_side === true,
  );
  return hasPendingApproval || hasPendingClientSideTool ? 'user-input-required' : 'tool-response-required';
}

function hasToolCalls(message: InternalEnrichedAssistantMessage): boolean {
  return Boolean(message.tool_calls && message.tool_calls.length > 0);
}

// Tool call ids issued by the last assistant message that have no matching
// tool response after it. Walks the context tail-first and stops at the last
// assistant message — under the invariant that older assistant tool_calls are
// already resolved, only the last assistant message can have open ids.
function getOpenToolCallIds(context: ContextMessage[]): Set<string> {
  const resolvedToolCallIds = new Set<string>();
  const openToolCallIds = new Set<string>();
  for (let i = context.length - 1; i >= 0; i--) {
    const msg = context[i];
    if (msg === undefined) {
      continue;
    }
    if (!isLLMContextMessage(msg)) {
      continue;
    }
    if (msg.role === 'tool') {
      resolvedToolCallIds.add(msg.tool_call_id);
      continue;
    }
    if (msg.role === 'assistant') {
      for (const tc of msg.tool_calls ?? []) {
        openToolCallIds.add(tc.id);
      }
      for (const id of resolvedToolCallIds) {
        openToolCallIds.delete(id);
      }
      break;
    }
  }
  return openToolCallIds;
}

function lastAssistantInContext(context: ContextMessage[]): InternalEnrichedAssistantMessage | undefined {
  return context.findLast(
    (msg): msg is InternalEnrichedAssistantMessage => isLLMContextMessage(msg) && msg.role === 'assistant',
  );
}

// Open tool calls that block a new user message: the open set minus those OpenToolCallCloser will
// auto-close during preSend. Lets a user message resume a thread whose only open calls are dangling
// regular tool calls (which the closer repairs), while still blocking on approval/client-side/
// sub-agent calls that genuinely need resolution. Takes the already-computed open set; copies it
// since it mutates (deletes) the closable ids.
function getUnclosableOpenToolCallIds(context: ContextMessage[], openToolCallIds: Set<string>): Set<string> {
  const blockingOpenToolCallIds = new Set(openToolCallIds);
  for (const id of getClosableOpenToolCallIds(context)) {
    blockingOpenToolCallIds.delete(id);
  }
  return blockingOpenToolCallIds;
}

function buildMCPInitializeEvent(initInfo: MCPServerInitInfo[], threadId: string): MCPInitializeEvent {
  return {
    type: EventType.MCP_INITIALIZE,
    id: newEventId(),
    created_at: new Date().toISOString(),
    thread_id: threadId,
    mcp_servers: initInfo,
  };
}

function buildMCPAuthRequiredEvent(
  authRequirementInfo: MCPAuthRequired[],
  threadId: string,
): InternalMCPAuthRequiredEvent {
  return {
    type: InternalEventType.MCP_AUTH_REQUIRED,
    id: newEventId(),
    created_at: new Date().toISOString(),
    mcp_servers: authRequirementInfo.flatMap(or => or.servers.map(s => ({ ...s, thread_ids: [threadId] }))),
    // threadId identifies which thread triggered auth for each server so AgentThreadOrchestrator can merge
    // auth events across parallel sub-agents by server.
    thread_id: null,
  };
}

function buildSandboxCreatedEvent(info: SandboxInfo): SandboxCreatedEvent {
  return {
    type: EventType.SANDBOX_CREATED,
    id: newEventId(),
    created_at: new Date().toISOString(),
    ...info,
    thread_id: null,
  };
}

function buildModelMessageEvent({
  assistantMessage,
  threadId,
  finishReason,
  usage,
  id,
}: {
  assistantMessage: InternalEnrichedAssistantMessage;
  threadId: string;
  finishReason: FinishReason | null;
  usage: ModelMessageUsage | undefined;
  id: string;
}): ModelMessageEvent {
  // `thinking_blocks` / `source` stay on the context message for replay; strip them from the client event.
  const { role, tool_calls, thinking_blocks, source, content, ...rest } = assistantMessage;
  void role;
  void thinking_blocks;
  void source;
  const event: ModelMessageEvent = {
    ...rest,
    // Tool-only completions store content: null on context (OpenAI replay) but the
    // SSE placeholder omits the field. Drop null/empty here so listTurnEvents JSON
    // matches a folded stream.
    ...(content && { content }),
    tool_calls: tool_calls?.map(toEnrichedToolCall),
    type: EventType.MODEL_MESSAGE,
    id,
    created_at: new Date().toISOString(),
    thread_id: threadId,
    finish_reason: finishReason,
    ...(usage && { usage }),
  };
  return event;
}

function validateUserMessage(
  message: { content: AgentInputUserMessage['content'] },
  blockingOpenToolCallIds: Set<string>,
  index: number,
): void {
  if (isEmptyMessageContent(message.content)) {
    throw new InvalidAgentSendInputError(`messages[${String(index)}] user message has empty content`);
  }
  if (blockingOpenToolCallIds.size > 0) {
    throw new InvalidAgentSendInputError('user message cannot be sent while approvals or questions are pending');
  }
}

function validateToolMessage(
  message: LLMToolMessage | UserToolResponseMessage,
  openToolCallIds: Set<string>,
  index: number,
): void {
  if (!openToolCallIds.has(message.tool_call_id)) {
    throw new InvalidAgentSendInputError(
      `messages[${String(index)}] no open tool call for tool_call_id '${message.tool_call_id}'`,
    );
  }
}

function validateApprovalMessage(
  message: UserToolApprovalMessage,
  pendingApprovalIds: Set<string>,
  index: number,
): void {
  if (!pendingApprovalIds.has(message.tool_call_id)) {
    throw new InvalidAgentSendInputError(
      `messages[${String(index)}] no pending approval for tool_call_id '${message.tool_call_id}'`,
    );
  }
}

function getPendingApprovalToolCalls(context: ContextMessage[]): InternalEnrichedToolCall[] {
  const openToolCallIds = getOpenToolCallIds(context);
  const decisions = scanApprovalDecisions(context);
  const assistant = lastAssistantInContext(context);
  return (assistant?.tool_calls ?? []).filter(
    tc => openToolCallIds.has(tc.id) && tc.tool_info.is_approval_required === true && !decisions.has(tc.id),
  );
}

function getPendingClientSideToolCalls(context: ContextMessage[]): InternalEnrichedToolCall[] {
  const openToolCallIds = getOpenToolCallIds(context);
  const assistant = lastAssistantInContext(context);
  return (assistant?.tool_calls ?? []).filter(tc => openToolCallIds.has(tc.id) && tc.tool_info.is_client_side === true);
}

function validateInputMessageTypesGivenContext(
  context: ContextMessage[],
  messages: AgentThreadRuntimeSendInput[],
): void {
  // Full open set: validates incoming tool responses and dedupes within the batch.
  const openToolCallIds = getOpenToolCallIds(context);
  // Subset that blocks a fresh user message: excludes calls OpenToolCallCloser will auto-close
  // during preSend, so a dangling regular tool call doesn't reject a user message it will repair.
  const blockingOpenToolCallIds = getUnclosableOpenToolCallIds(context, openToolCallIds);
  const pendingApprovalIds = new Set(getPendingApprovalToolCalls(context).map(tc => tc.id));
  const pendingClientSideIds = new Set(getPendingClientSideToolCalls(context).map(tc => tc.id));

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i];
    if (m === undefined) {
      continue;
    }
    if (isApprovalDecisionMessage(m)) {
      validateApprovalMessage(m, pendingApprovalIds, i);
      pendingApprovalIds.delete(m.tool_call_id);
    } else if (isInputUserMessage(m)) {
      validateUserMessage(m, blockingOpenToolCallIds, i);
    } else if (isClientSideToolResponseMessage(m) || isLLMToolMessage(m)) {
      validateToolMessage(m, openToolCallIds, i);
      openToolCallIds.delete(m.tool_call_id);
      blockingOpenToolCallIds.delete(m.tool_call_id);
      pendingClientSideIds.delete(m.tool_call_id);
    } else {
      const _exhaustive: never = m;
      throw new InvalidAgentSendInputError(
        `messages[${String(i)}] has unsupported type: ${JSON.stringify(_exhaustive)}`,
      );
    }
  }

  // A send for a thread awaiting user input must resolve every pending approval and client-side
  // tool call in the same batch; any left unresolved (including an empty batch) is a blocker.
  if (pendingApprovalIds.size > 0 || pendingClientSideIds.size > 0) {
    const missing = [...pendingApprovalIds, ...pendingClientSideIds];
    throw new InvalidAgentSendInputError(
      `Send batch must resolve all pending tool calls awaiting user input. Missing: ${missing.join(', ')}`,
    );
  }
}

async function buildModelMessageDeltaEvent({
  chunk,
  threadId,
  toolMapping,
  usage,
  id,
  logger,
}: {
  chunk: ExtendedChatCompletionChunk;
  threadId: string;
  toolMapping: Map<string, MappedMCPTool>;
  usage: ModelMessageUsage | undefined;
  id: string;
  logger: Logger;
}): Promise<ModelMessageDeltaEvent | undefined> {
  const choice = chunk.choices[0];
  const delta = choice?.delta;
  const finishReason = choice?.finish_reason;

  if (!delta || (Object.keys(delta).length === 0 && !finishReason && !usage)) {
    return;
  }

  // Drop empty deltas that carry no displayable or actionable data
  if (!delta.tool_calls?.length && !delta.content && !delta.reasoning_content && !finishReason && !usage) {
    return;
  }

  const toolCalls = delta.tool_calls ?? [];
  for (const toolCall of toolCalls) {
    if (toolCall.function?.name) {
      const toolInfo = toolMapping.get(toolCall.function.name);
      if (!toolInfo) {
        logger.warn(`LLM called unknown tool: Tool ${toolCall.function.name} not found in tool mapping.`);
        toolCall.tool_info = toToolCallInfo(makeUnknownToolInfo(toolCall.function.name));
        continue;
      }
      toolCall.tool_info = toToolCallInfo(
        await toolInfo.toolSet.toolCallInfo({ name: toolInfo.originalToolName }, false /* resolveUnderlyingTool */),
      );
    }
  }

  // Strip legacy `function_call` and replay-only `thinking_blocks` so neither reaches the client or delta stream.
  const { role, function_call, thinking_blocks, ...deltaWithoutRole } = delta;
  void role;
  void function_call;
  void thinking_blocks;
  return {
    ...deltaWithoutRole,
    type: EventType.MODEL_MESSAGE_DELTA,
    id,
    thread_id: threadId,
    ...(finishReason && { finish_reason: finishReason }),
    ...(usage && { usage }),
  };
}

async function enrichAssistantMessage({
  assistantMessage,
  toolMapping,
  resolveUnderlyingTool,
}: {
  assistantMessage: RawAssistantMessage;
  toolMapping: Map<string, MappedMCPTool>;
  resolveUnderlyingTool: boolean;
}): Promise<InternalEnrichedAssistantMessage> {
  // Omit tool_calls when empty; OpenAI rejects `tool_calls: []` on replay.
  if (!assistantMessage.tool_calls?.length) {
    const { tool_calls, ...rest } = assistantMessage;
    void tool_calls;
    return rest;
  }

  // Sequential loop instead of Promise.all: the first call populates the MCP server's tool cache
  // (via listTools), making subsequent calls instant cache hits.
  // No race conditions either way but parallelism buys nothing here.
  const enrichedToolCalls = [];
  for (const toolCall of assistantMessage.tool_calls) {
    const toolInfo = toolMapping.get(toolCall.function.name);
    if (!toolInfo) {
      enrichedToolCalls.push({ ...toolCall, tool_info: makeUnknownToolInfo(toolCall.function.name) });
      continue;
    }
    const tool_info = await toolInfo.toolSet.toolCallInfo(
      {
        name: toolInfo.originalToolName,
        ...(resolveUnderlyingTool ? { arguments: tryParseToolArgs(toolCall.function.arguments) } : {}),
      },
      resolveUnderlyingTool,
    );
    enrichedToolCalls.push({ ...toolCall, tool_info });
  }
  return { ...assistantMessage, tool_calls: enrichedToolCalls };
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Args are only used by DeferredTool to delegate to the underlying server.
// Defensive parse — hallucinated JSON shouldn't crash assistant-message construction.
function tryParseToolArgs(args: string | undefined): Record<string, unknown> {
  if (!args) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(args);
    return isJsonObject(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// State-sync contract: in-memory state must stay consistent with what the consumer
// def foo():
//   for x in range(1, 10):
//   yield x
//   # This cannot raise exception
//   # This does not execute if update_redis fails.
//   update_local_context(x)
// for x in foo():
// # This can raise exception.
// update_redis(x)

export class AgentThread {
  readonly threadId: string;
  readonly parent?: AgentParent | undefined;
  readonly definition: AgentDefinition;
  readonly title: string;
  readonly agentInfo?: AgentInfo | undefined;

  private context: ContextMessage[];
  private currentContextUsage: CurrentContextUsage;
  private preSendContextProcessors: PreSendContextProcessor[];
  private preLLMContextProcessors: PreLLMAgentContextProcessor[];
  private preEphemeralLLMContextProcessors: PreLLMEphemeralAgentContextProcessor[];
  private postToolCallContextProcessor: PostToolCallAgentContextProcessor[];

  private instruction: string | undefined;
  private toolResponseProcessors: ToolResponseProcessor[];
  private instructionBuilders: readonly ((builder: InstructionBuilder) => void)[];
  private systemToolSets: readonly IToolSet[];
  private deferredTool?: DeferredTool | undefined;
  private convertedTools: ConvertToolsResult | undefined;
  private pendingSandboxCreatedEvents: SandboxCreatedEvent[] = [];
  private sandbox?: Sandbox | undefined;
  private readonly tracing: AgentTracing;
  private readonly logger: Logger;

  private metrics: AgentThreadMetrics = createEmptyAgentThreadMetrics();
  private tfyManagedServerNames = new Set<string>();

  private contextBusy = false;
  private preSendRanThisTurn = false;
  private currentState: AgentThreadState | null = null;
  private readonly preComputedCompletion?: SubAgentCompletionMarker | undefined;
  /** Mirrored capability KV — source for toSnapshot().capability_state. */
  private capabilityState: CapabilityState = {};
  private readonly capabilityStateKeys: ReadonlySet<string>;

  constructor(input: AgentThreadConstructorInput) {
    this.tracing = input.tracing;
    this.logger = input.logger.child({ module: 'AgentThread' });
    this.threadId = input.threadId;
    this.definition = input.definition;
    this.context = input.context ? [...input.context] : [];
    this.title = input.title;
    this.parent = input.parent;
    this.currentContextUsage = input.currentContextUsage ?? getEmptyCurrentContextUsage();
    this.agentInfo = input.agentInfo;
    this.preComputedCompletion = input.preComputedCompletion;
    this.sandbox = input.sandbox;

    const capabilities = input.capabilities ?? [];
    this.systemToolSets = capabilities.flatMap(c => c.systemToolSets ?? []);
    this.preLLMContextProcessors = capabilities.flatMap(c => c.preLLMProcessors ?? []);
    this.preEphemeralLLMContextProcessors = capabilities.flatMap(c => c.preLLMEphemeralProcessors ?? []);
    this.postToolCallContextProcessor = capabilities.flatMap(c => c.postToolCallProcessors ?? []);
    this.toolResponseProcessors = capabilities.flatMap(c => c.toolResponseProcessors ?? []);
    this.instructionBuilders = capabilities.flatMap(c => c.instructionBuilders ?? []);
    const capabilityPreSend = capabilities.flatMap(c => c.preSendProcessors ?? []);
    // OpenToolCallCloser is fixed core before contributed preSend processors.
    this.preSendContextProcessors = [new OpenToolCallCloser(), ...capabilityPreSend];

    assertUniqueStateKeys(capabilities);
    const claimed = claimCapabilityState(capabilities, input.capabilityState, this.logger);
    this.capabilityState = claimed;
    this.capabilityStateKeys = new Set(
      capabilities.map(c => c.state?.key).filter((k): k is string => typeof k === 'string'),
    );
    for (const capability of capabilities) {
      if (!capability.state) {
        continue;
      }
      const value = claimed[capability.state.key];
      if (value !== undefined) {
        capability.state.load(value);
      }
    }

    if (this.definition.toolSets?.length) {
      this.deferredTool = new DeferredTool(this.definition.toolSets, {
        tracing: this.tracing,
        logger: input.logger,
      });
    }

    this.instruction = this.buildInstruction(this.definition.instruction);
  }

  private buildInstruction(userInstruction?: string): string {
    const identity = this.parent ? SUB_AGENT_IDENTITY : ROOT_AGENT_IDENTITY;
    const builder = InstructionBuilder.createSystemPrompt(identity);
    const capabilities = builder.beginSection('agent-capabilities');
    capabilities.addSection('internal-messages', INTERNAL_SYSTEM_PROMPT);

    if (this.sandbox) {
      this.sandbox.buildInstruction(capabilities);
    }
    if (this.deferredTool) {
      this.deferredTool.buildInstruction(capabilities);
    }
    for (const build of this.instructionBuilders) {
      build(capabilities);
    }
    if (!this.parent && userInstruction?.trim()) {
      builder.addSection('user-instructions', userInstruction.trim(), true);
    }
    return builder.build();
  }

  public async *send(messages: AgentThreadRuntimeSendBatch): AsyncGenerator<AgentThreadAppendContext, void, unknown> {
    // An empty batch is a no-op only when the thread is not awaiting user input.
    // While awaiting input, fall through so the validator rejects the empty/incomplete batch.
    if (messages.length === 0 && !this.isAwaitingUserInput()) {
      return;
    }
    this.throwIfContextBusy();

    this.contextBusy = true;
    try {
      for await (const event of this.executeContextProcessors('preSend')) {
        yield event;
      }
      this.preSendRanThisTurn = true;

      validateInputMessageTypesGivenContext(this.context, messages);

      const approvals: UserToolApprovalMessage[] = [];
      const clientSideToolResponses: UserToolResponseMessage[] = [];
      const contextMessages: (LLMUserMessage | LLMToolMessage)[] = [];

      for (const m of messages) {
        if (isApprovalDecisionMessage(m)) {
          approvals.push(m);
        } else if (isClientSideToolResponseMessage(m)) {
          clientSideToolResponses.push(m);
        } else if (isInputUserMessage(m)) {
          const result = await processAgentUserInput(m, this.sandbox);
          contextMessages.push(result.message);
          if (result.sandboxCreated) {
            this.pendingSandboxCreatedEvents.push(buildSandboxCreatedEvent(result.sandboxCreated));
          }
        } else if (isLLMToolMessage(m)) {
          contextMessages.push(m);
        } else {
          const _exhaustive: never = m;
          throw new InvalidAgentSendInputError(`Unsupported send input: ${JSON.stringify(_exhaustive)}`);
        }
      }

      if (approvals.length > 0 || clientSideToolResponses.length > 0) {
        const approvalContext: AgentApprovalDecisionMessage[] = approvals.map(a => ({
          type: EventType.USER_TOOL_APPROVAL,
          tool_call_id: a.tool_call_id,
          approval: a.approval,
        }));
        const toolResponseContext: LLMToolMessage[] = clientSideToolResponses.map(m => ({
          role: 'tool',
          tool_call_id: m.tool_call_id,
          content: m.content,
        }));
        yield* this.appendToContext({
          context: [...approvalContext, ...toolResponseContext],
          output: [],
          currentContextUsage: undefined,
          usage: undefined,
        });
      }
      if (contextMessages.length > 0) {
        yield* this.appendToContext({
          context: contextMessages,
          output: [],
          currentContextUsage: undefined,
          usage: undefined,
        });
      }
    } finally {
      this.contextBusy = false;
    }
  }

  private throwIfContextBusy(): void {
    if (this.contextBusy) {
      throw new Error(`context is busy for thread ${this.threadId}`);
    }
  }

  private deriveState(): AgentThreadState {
    const next = deriveAgentThreadState(this.context);
    if (this.currentState) {
      assertValidTransition(this.currentState, next);
    }
    this.currentState = next;
    return next;
  }

  private *appendToContext(opts: {
    context: ContextMessage[];
    output: AgentOutputEvent[];
    currentContextUsage: CurrentContextUsage | undefined;
    usage: CompletionUsage | undefined;
    completion?: SubAgentCompletionMarker | undefined;
  }): Generator<AgentThreadAppendContext, void, unknown> {
    const { context, output, currentContextUsage, usage, completion } = opts;

    const newCurrentContextUsage =
      currentContextUsage ??
      mergeCurrentContextUsage(this.currentContextUsage, estimateTokensForContextMessages(context));

    const event: AgentThreadAppendContext = {
      type: InternalEventType.AGENT_CONTEXT_APPEND,
      thread_id: this.threadId,
      context,
      output,
      current_context_usage: newCurrentContextUsage,
      ...(completion && { completion }),
    };

    // Update metrics before yield so we still count it if the stream stops here.
    if (usage) {
      updateMetricsFromUsage(this.metrics, usage);
    }

    yield event;

    this.context = this.context.concat(context);
    this.currentContextUsage = newCurrentContextUsage;
  }

  private *overwriteContext(
    payload: AgentContextProcessorOverwriteContext,
  ): Generator<ThreadOverwriteContextEvent, void, unknown> {
    const event: ThreadOverwriteContextEvent = {
      thread_id: this.threadId,
      ...payload,
    };
    // Update metrics before yield so we still count it if the stream stops here.
    updateMetricsFromUsage(this.metrics, payload.usage);

    yield event;
    this.context = payload.context;
    this.currentContextUsage = payload.current_context_usage;
    this.metrics.total_summarizations++;
  }

  private generateErrorEvent(message: string, output?: ModelMessageEvent): InternalThreadDoneEvent {
    return {
      type: InternalEventType.AGENT_DONE,
      status: 'error',
      thread_id: this.threadId,
      title: this.title,
      error: message,
      parent: this.parent,
      send_to_parent: this.parent
        ? {
            role: 'tool',
            content: message,
            tool_call_id: this.parent.tool_call_id,
          }
        : undefined,
      ...(output && { output }),
    };
  }

  public hasOpenToolCallId(toolCallId: string): boolean {
    return getOpenToolCallIds(this.context).has(toolCallId);
  }

  // True when this thread is paused waiting on the user to resolve a pending tool
  // approval or a client-side tool response.
  public isAwaitingUserInput(): boolean {
    return (
      getPendingApprovalToolCalls(this.context).length > 0 || getPendingClientSideToolCalls(this.context).length > 0
    );
  }

  // Pure validation of an input batch against this thread's current context; throws
  // on an invalid/incomplete batch without mutating the context.
  public validateSendInput(messages: AgentThreadRuntimeSendBatch): void {
    validateInputMessageTypesGivenContext(this.context, messages);
  }

  public toSnapshot(): AgentThreadSnapshot {
    const capability_state = Object.keys(this.capabilityState).length > 0 ? { ...this.capabilityState } : null;
    return {
      thread_id: this.threadId,
      context: this.context,
      current_context_usage: this.currentContextUsage,
      parent: this.parent ?? null,
      agent_info: this.agentInfo ?? null,
      completion: this.preComputedCompletion ?? null,
      capability_state,
    };
  }

  public getAgentThreadMetrics(): AgentThreadMetrics {
    return { ...this.metrics };
  }

  private transformToLLMRequest(tools: ChatCompletionTool[]): LLMCreateParamsStreaming {
    let messages: ChatCompletionMessageParam[] = [];

    if (this.instruction) {
      messages.push({
        role: 'system',
        content: this.instruction,
      });
    }

    if (this.definition.messages) {
      for (const msg of this.definition.messages) {
        if (isLLMContextMessage(msg)) {
          messages.push(toOpenAIChatMessage(msg));
        }
      }
    }

    // NOTE: all this code-golf is to remove `tool_info` before sending the message to Gateway
    // ApprovalDecisionMessage rows are persisted in context but must not be sent to the LLM.
    const contextMessages = this.context.filter(isLLMContextMessage).map(msg => toOpenAIChatMessage(msg));

    messages.push(...contextMessages);

    for (const processor of this.preEphemeralLLMContextProcessors) {
      messages = processor.processPreLLMEphemeral(messages) ?? messages;
    }

    // modelParams may include provider extensions (e.g. reasoning_effort) beyond the SDK's
    // ChatCompletionCreateParamsStreaming field set; assign after constructing the typed body.
    // Model identity is owned by modelClient — do not set `model` on the request.
    const requestBody: LLMCreateParamsStreaming = {
      messages,
      stream: true,
      ...(this.definition.responseFormat !== undefined
        ? { response_format: toOpenAIResponseFormat(this.definition.responseFormat) }
        : {}),
    };
    if (this.definition.modelParams) {
      Object.assign(requestBody, this.definition.modelParams);
    }

    if (tools.length > 0) {
      requestBody.tools = tools;
    }

    return requestBody;
  }

  private computeAssistantMessageUsage(params: {
    requestBody: LLMCreateParamsStreaming;
    usage: CompletionUsage;
    toolMapping: Map<string, MappedMCPTool>;
  }): ModelMessageUsage {
    const { requestBody, usage, toolMapping } = params;
    // Sub-agents have no <user-instructions> section — their agent.instruction is
    // SUB_AGENT_IDENTITY which is harness content, not user-defined instructions.
    const trimmedInstruction = this.definition.instruction?.trim() ?? '';
    const instructionsEstimate = this.parent ? 0 : Math.round(estimateTokensForString(trimmedInstruction));

    const skillsEstimate = this.sandbox?.estimateSkillsTokens() ?? 0;

    let tfyManagedToolTokens = 0;
    let userToolTokens = 0;
    if (requestBody.tools) {
      for (const tool of requestBody.tools) {
        const toolTokens = Math.round(estimateTokensForString(JSON.stringify(tool)));
        const info = 'function' in tool ? toolMapping.get(tool.function.name) : undefined;
        if (info && this.tfyManagedServerNames.has(info.toolSet.name)) {
          tfyManagedToolTokens += toolTokens;
        } else {
          userToolTokens += toolTokens;
        }
      }
    }

    const totalInstructionTokens = Math.round(estimateTokensForString(this.instruction ?? ''));
    const harnessInstructionTokens = Math.max(0, totalInstructionTokens - instructionsEstimate - skillsEstimate);
    const harnessEstimate = harnessInstructionTokens + tfyManagedToolTokens;

    const estimatedComponentsTotal = harnessEstimate + skillsEstimate + instructionsEstimate + userToolTokens;
    const messagesEstimate = Math.max(0, usage.input_tokens - estimatedComponentsTotal);

    return {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read_tokens: usage.cache_read_tokens,
      cache_write_tokens: usage.cache_write_tokens,
      input_tokens_breakdown: {
        harness: harnessEstimate,
        skills: skillsEstimate,
        instructions: instructionsEstimate,
        tool_definitions: userToolTokens,
        messages: messagesEstimate,
      },
    };
  }

  private executeContextProcessors(hook: 'preSend'): AsyncGenerator<AgentThreadAppendContext, void, unknown>;
  private executeContextProcessors(
    hook: 'preLLM' | 'postToolCall',
  ): AsyncGenerator<
    | ThreadOverwriteContextEvent
    | AgentThreadAppendContext
    | { type: typeof InternalEventType.PASSTHROUGH; event: RegisteredPassthroughEvent }
    | InternalCapabilityStateEvent,
    void,
    unknown
  >;
  private async *executeContextProcessors(
    hook: 'preSend' | 'preLLM' | 'postToolCall',
  ): AsyncGenerator<
    | ThreadOverwriteContextEvent
    | AgentThreadAppendContext
    | { type: typeof InternalEventType.PASSTHROUGH; event: RegisteredPassthroughEvent }
    | InternalCapabilityStateEvent,
    void,
    unknown
  > {
    let processors: ((
      execution: Readonly<AgentThreadExecutionContext>,
    ) => AsyncIterable<AgentContextProcessorOutput>)[];
    switch (hook) {
      case 'preSend':
        processors = this.preSendContextProcessors.map(p => p.processPreSend.bind(p));
        break;
      case 'preLLM':
        processors = this.preLLMContextProcessors.map(p => p.processPreLLM.bind(p));
        break;
      case 'postToolCall':
        processors = this.postToolCallContextProcessor.map(p => p.processPostToolCall.bind(p));
        break;
      default:
        throw new Error(`Unknown hook: ${String(hook)}`);
    }

    const execution: Readonly<AgentThreadExecutionContext> = {
      threadId: this.threadId,
      sandbox: this.sandbox,
      currentContextUsage: this.currentContextUsage,
      context: this.context,
    };

    for (const processor of processors) {
      for await (const response of processor(execution)) {
        switch (response.type) {
          case InternalEventType.AGENT_CONTEXT_APPEND:
            yield* this.appendToContext({
              context: response.context,
              output: response.output,
              currentContextUsage: response.current_context_usage ?? this.currentContextUsage,
              usage: undefined,
            });
            break;
          case EventType.AGENT_CONTEXT_OVERWRITE:
            yield* this.overwriteContext(response);
            break;
          case InternalEventType.PASSTHROUGH:
            yield response;
            break;
          case InternalEventType.CAPABILITY_STATE:
            if (!this.capabilityStateKeys.has(response.key)) {
              throw new AgentHarnessError(
                'capability_state_error',
                `CAPABILITY_STATE key '${response.key}' is not declared by any capability on thread '${this.threadId}'`,
              );
            }
            yield {
              type: InternalEventType.CAPABILITY_STATE,
              thread_id: this.threadId,
              key: response.key,
              state: response.state,
            };
            this.capabilityState[response.key] = response.state;
            break;
          default: {
            const _exhaustive: never = response;
            return _exhaustive;
          }
        }
      }
    }
  }

  private async init(): Promise<{
    initializationInfo: MCPServerInitInfo[];
    authRequirementInfo: MCPAuthRequired[];
  }> {
    if (this.convertedTools) {
      return { initializationInfo: [], authRequirementInfo: [] };
    }
    return this.initTools();
  }

  private async initTools(): Promise<{
    initializationInfo: MCPServerInitInfo[];
    authRequirementInfo: MCPAuthRequired[];
  }> {
    const tfyManagedServers: IToolSet[] = [...this.systemToolSets];
    if (this.sandbox) {
      tfyManagedServers.push(this.sandbox);
    }
    if (this.deferredTool) {
      tfyManagedServers.push(this.deferredTool);
    }
    const userServers = [...(this.definition.toolSets ?? [])];

    const { convertedTools, initializationInfo, authRequirementInfo } = await convertMCPServersToTools({
      tfyManagedServers,
      userServers,
    });
    this.convertedTools = convertedTools;
    this.tfyManagedServerNames = new Set(tfyManagedServers.map(s => s.name));
    return { initializationInfo, authRequirementInfo };
  }

  private getConvertedTools(): ConvertToolsResult {
    if (!this.convertedTools) {
      throw new Error('unreachable');
    }
    return this.convertedTools;
  }

  private async *stepLLMCall(
    tools: ChatCompletionTool[],
    toolMapping: Map<string, MappedMCPTool>,
    signal?: AbortSignal,
  ): AsyncGenerator<AgentThreadEvent, { outcome: StepOutcome; modelMessageEventId: string }, unknown> {
    const modelMessageEventId = newEventId();
    if (signal?.aborted) {
      return { outcome: 'exit', modelMessageEventId };
    }

    for await (const event of this.executeContextProcessors('preLLM')) {
      yield event;
    }

    const requestBody = this.transformToLLMRequest(tools);
    const llmStream = this.definition.modelClient.create(requestBody);

    // We start the delta stream with a model message event.
    yield {
      type: EventType.MODEL_MESSAGE,
      thread_id: this.threadId,
      created_at: new Date().toISOString(),
      id: modelMessageEventId,
    } satisfies ModelMessageEvent;

    let firstDeltaTimestamped = false;
    let result = await llmStream.next();
    let modelMessageUsage: ModelMessageUsage | undefined = undefined;
    while (!result.done) {
      const chunk = result.value;
      if (chunk.usage) {
        modelMessageUsage = this.computeAssistantMessageUsage({
          requestBody,
          usage: chunk.usage,
          toolMapping,
        });
      }
      const event = await buildModelMessageDeltaEvent({
        chunk,
        threadId: this.threadId,
        toolMapping,
        usage: modelMessageUsage,
        id: modelMessageEventId,
        logger: this.logger,
      });
      if (event) {
        if (!firstDeltaTimestamped) {
          firstDeltaTimestamped = true;
          yield { ...event, created_at: new Date().toISOString() };
        } else {
          yield event;
        }
      }
      result = await llmStream.next();
    }

    // If the stream was aborted mid-way, result.value.output is only a partial
    // accumulation of the deltas — not the true complete response. Skip the
    // final model.message event to avoid emitting an inconsistent assembled message.
    if (signal?.aborted) {
      return { outcome: 'exit', modelMessageEventId };
    }

    // should be computed by this point but in case provider never gives out any delta with usage, compute it now.
    modelMessageUsage ??= this.computeAssistantMessageUsage({
      requestBody,
      usage: result.value.usage,
      toolMapping,
    });
    const assistantMessage: InternalEnrichedAssistantMessage = await enrichAssistantMessage({
      assistantMessage: result.value.output,
      toolMapping,
      // During context persistence, we have the complete message and hence the tool arguments are available.
      // Hence, we resolve the underlying tool to get the tool information.
      resolveUnderlyingTool: true,
    });
    const finishReason = result.value.finish_reason;
    const agentAssistantMessage = buildModelMessageEvent({
      assistantMessage: await enrichAssistantMessage({
        assistantMessage: result.value.output,
        toolMapping,
        // Same unresolved wrapper as SSE deltas so listTurnEvents matches a folded stream.
        resolveUnderlyingTool: false,
      }),
      threadId: this.threadId,
      finishReason,
      usage: modelMessageUsage,
      id: modelMessageEventId,
    });

    let completion: SubAgentCompletionMarker | undefined;
    if (this.parent) {
      if (finishReason === 'length') {
        const errorMessage = assistantMessageContentToStringForSubAgent(
          assistantMessage.content,
          'max_tokens breached',
        );
        completion = {
          type: 'error',
          output: agentAssistantMessage,
          error_message: errorMessage,
          send_to_parent: { role: 'tool', tool_call_id: this.parent.tool_call_id, content: errorMessage },
        };
      } else if (!hasToolCalls(assistantMessage)) {
        const content = assistantMessageContentToStringForSubAgent(assistantMessage.content);
        completion = {
          type: 'done',
          output: agentAssistantMessage,
          send_to_parent: { role: 'tool', tool_call_id: this.parent.tool_call_id, content },
        };
      }
    }

    yield* this.appendToContext({
      context: [assistantMessage],
      output: [agentAssistantMessage],
      currentContextUsage: currentContextUsageFromCompletion(result.value.usage),
      usage: result.value.usage,
      completion,
    });

    if (finishReason === 'length') {
      const errorContent = completion?.error_message ?? 'max_tokens breached';
      yield this.generateErrorEvent(errorContent, agentAssistantMessage);
      return { outcome: 'exit', modelMessageEventId };
    }

    if (!hasToolCalls(assistantMessage)) {
      yield {
        type: InternalEventType.AGENT_DONE,
        status: 'done',
        thread_id: this.threadId,
        title: this.title,
        output: agentAssistantMessage,
        parent: this.parent,
        send_to_parent: completion?.send_to_parent,
      };
      return { outcome: 'exit', modelMessageEventId };
    }

    return { outcome: 'continue', modelMessageEventId };
  }

  private async *stepToolResponse(
    toolMapping: Map<string, MappedMCPTool>,
  ): AsyncGenerator<AgentThreadEvent, StepOutcome, unknown> {
    const assistantMessage = lastAssistantInContext(this.context);
    if (!assistantMessage) {
      throw new Error('unreachable');
    }

    const openIds = getOpenToolCallIds(this.context);
    const openCalls = assistantMessage.tool_calls?.filter(tc => openIds.has(tc.id)) ?? [];
    const decisions = scanApprovalDecisions(this.context);

    const assistantForExecution: InternalEnrichedAssistantMessage = {
      ...assistantMessage,
      tool_calls: openCalls,
    };
    const {
      toolCallResults,
      initializationInfo,
      createThreadEvents,
      sandboxCreated,
      authRequirementInfo,
      approvalRequiredToolCalls,
      clientSideToolCalls,
      events: passthroughEvents,
    } = await executeToolCalls({
      assistantMessage: assistantForExecution,
      toolMapping,
      threadId: this.threadId,
      approvalDecisions: decisions,
    });
    void clientSideToolCalls;
    if (approvalRequiredToolCalls.length > 0) {
      throw new Error('Unreachable');
    }
    this.metrics.total_tool_calls += toolCallResults.length;
    this.metrics.total_sub_agents += createThreadEvents.length;

    if (initializationInfo.length > 0) {
      yield buildMCPInitializeEvent(initializationInfo, this.threadId);
    }

    if (sandboxCreated) {
      yield buildSandboxCreatedEvent(sandboxCreated);
    }

    for (const event of passthroughEvents) {
      yield { type: InternalEventType.PASSTHROUGH, event };
    }

    const toolIdsBeforeProcessing = toolCallResults.map(t => t.message.tool_call_id);
    const toolResponseExecution: Readonly<AgentThreadExecutionContext> = {
      threadId: this.threadId,
      sandbox: this.sandbox,
      currentContextUsage: this.currentContextUsage,
      context: this.context,
    };
    for (const processor of this.toolResponseProcessors) {
      const processorResult = await processor.process(toolCallResults, toolResponseExecution);
      if (processorResult.sandboxCreated) {
        yield buildSandboxCreatedEvent(processorResult.sandboxCreated);
      }
      for (const event of processorResult.events ?? []) {
        yield { type: InternalEventType.PASSTHROUGH, event };
      }
    }
    if (toolIdsBeforeProcessing.length !== toolCallResults.length) {
      throw Error('Some tool call processor has removed tool call.');
    }
    const toolIdsAfterProcessing = new Set(toolCallResults.map(t => t.message.tool_call_id));

    if (!toolIdsBeforeProcessing.every(id => toolIdsAfterProcessing.has(id))) {
      throw Error('Tool call IDs do not match after processing.');
    }

    const agentToolMessages: ToolResponseEvent[] = toolCallResults.map(t => {
      const { role, ...toolMessage } = t.message;
      void role;
      return {
        ...toolMessage,
        type: EventType.TOOL_RESPONSE,
        id: newEventId(),
        created_at: t.completedAt,
        thread_id: this.threadId,
      };
    });
    for (const msg of agentToolMessages) {
      yield msg;
    }
    // tool.response is persisted by the session/response layer when yielded; only mutate context here.
    yield* this.appendToContext({
      context: toolCallResults.map(t => t.message),
      output: [],
      currentContextUsage: undefined,
      usage: undefined,
    });

    if (authRequirementInfo.length > 0) {
      yield buildMCPAuthRequiredEvent(authRequirementInfo, this.threadId);
      return 'exit';
    }

    for await (const event of this.executeContextProcessors('postToolCall')) {
      yield event;
    }
    for (const event of createThreadEvents) {
      yield event;
    }
    if (createThreadEvents.length > 0) {
      return 'exit';
    }

    return 'continue';
  }

  private *stepUserInputRequired(modelMessageEventId: string): Generator<AgentThreadEvent, StepOutcome, unknown> {
    const pendingClientSideToolCalls = getPendingClientSideToolCalls(this.context);
    if (pendingClientSideToolCalls.length > 0) {
      const responseRequiredEvent: ToolResponseRequiredEvent = {
        type: EventType.TOOL_RESPONSE_REQUIRED,
        id: newEventId(),
        created_at: new Date().toISOString(),
        thread_id: this.threadId,
        tool_calls: pendingClientSideToolCalls.map(tc => ({ id: tc.id, source_event_id: modelMessageEventId })),
      };
      yield responseRequiredEvent;
    }

    const pendingApprovalToolCalls = getPendingApprovalToolCalls(this.context);
    if (pendingApprovalToolCalls.length > 0) {
      const event: ToolApprovalRequiredEvent = {
        type: EventType.TOOL_APPROVAL_REQUIRED,
        id: newEventId(),
        created_at: new Date().toISOString(),
        thread_id: this.threadId,
        tool_calls: pendingApprovalToolCalls.map(({ id }) => ({ id, source_event_id: modelMessageEventId })),
      };
      yield event;
    }
    return 'exit';
  }

  private buildReplayEvent(c: SubAgentCompletionMarker): InternalThreadDoneEvent {
    const base = {
      type: InternalEventType.AGENT_DONE,
      thread_id: this.threadId,
      title: this.title,
      parent: this.parent,
      send_to_parent: c.send_to_parent,
    };
    return c.type === 'done'
      ? { ...base, status: 'done', output: c.output }
      : { ...base, status: 'error', error: c.error_message ?? 'Sub-agent errored', output: c.output };
  }

  public async *execute(options?: {
    signal?: AbortSignal | undefined;
  }): AsyncGenerator<AgentThreadEvent, void, unknown> {
    const signal = options?.signal;

    this.throwIfContextBusy();
    this.contextBusy = true;
    this.currentState = null;

    // there should always be this top level try-catch block because agent execution cant raise an error. it should yield an error event.
    try {
      if (this.preComputedCompletion) {
        yield this.buildReplayEvent(this.preComputedCompletion);
        return;
      }

      if (!this.preSendRanThisTurn) {
        for await (const event of this.executeContextProcessors('preSend')) {
          yield event;
        }
      }
      this.preSendRanThisTurn = false;
      const { initializationInfo, authRequirementInfo } = await this.tracing.withInitSpan(() => this.init());

      if (initializationInfo.length > 0) {
        yield buildMCPInitializeEvent(initializationInfo, this.threadId);
      }

      if (authRequirementInfo.length > 0) {
        yield buildMCPAuthRequiredEvent(authRequirementInfo, this.threadId);
        return;
      }

      const { tools, toolMapping } = this.getConvertedTools();

      const iterationLimit = this.definition.iterationLimit ?? DEFAULT_ITERATION_LIMIT;
      // Starts empty; set only after stepLLMCall in this execute(). That is intentional:
      // user-input-required is only reachable here right after an LLM step that produced
      // pending approval/client-side tools (which sets currentModelMessageEventId first).
      // A resumed turn that is still awaiting user input never reaches this loop — orchestrator
      // send() / validateSendInput rejects empty or incomplete batches before execute runs.
      let currentModelMessageEventId = '';

      for (;;) {
        for (;;) {
          const sandboxCreatedEvent = this.pendingSandboxCreatedEvents.shift();
          if (sandboxCreatedEvent === undefined) {
            break;
          }
          yield sandboxCreatedEvent;
        }

        const state = this.deriveState();
        let outcome: StepOutcome;
        switch (state) {
          case 'llm-call-required': {
            // Cancel only before network/side-effecting steps (LLM call, tool execution), never before 'user-input-required', so the required event is always emitted once the assistant message is committed.
            if (signal?.aborted) {
              return;
            }
            if (this.metrics.iterations >= iterationLimit) {
              yield this.generateErrorEvent(
                `You have reached iteration limit of ${String(iterationLimit)}, please request again`,
              );
              return;
            }
            this.metrics.iterations++;

            const llmResult = yield* this.stepLLMCall(tools, toolMapping, signal);
            outcome = llmResult.outcome;
            currentModelMessageEventId = llmResult.modelMessageEventId;
            break;
          }
          case 'tool-response-required': {
            if (signal?.aborted) {
              return;
            }
            outcome = yield* this.stepToolResponse(toolMapping);
            break;
          }
          case 'user-input-required': {
            // Intentionally no cancellation check here — see comment in 'llm-call-required'.
            // source_event_id comes from currentModelMessageEventId; see comment where it is declared.
            outcome = yield* this.stepUserInputRequired(currentModelMessageEventId);
            break;
          }
          default: {
            throw new Error('unreachable');
          }
        }
        if (outcome === 'exit') {
          return;
        }
      }
    } catch (error) {
      // Providers / transports often reject with plain objects; instanceof Error would
      // otherwise collapse those into an opaque "Unknown error occurred" in Agent Steps.
      this.logger.error('Agent thread execution failed', extractErrorLogFields(error));
      yield this.generateErrorEvent(describeUnknownError(error));
    } finally {
      this.contextBusy = false;
    }
  }
}

function assertUniqueStateKeys(capabilities: readonly AgentCapability[]): void {
  const seen = new Set<string>();
  for (const capability of capabilities) {
    const key = capability.state?.key;
    if (!key) {
      continue;
    }
    if (seen.has(key)) {
      throw new AgentHarnessError(
        'capability_state_error',
        `Duplicate capability state key '${key}' — each key may be claimed by at most one capability`,
      );
    }
    seen.add(key);
  }
}

function claimCapabilityState(
  capabilities: readonly AgentCapability[],
  input: CapabilityState | undefined,
  logger: Logger,
): CapabilityState {
  if (!input) {
    return {};
  }
  const claimedKeys = new Set(capabilities.map(c => c.state?.key).filter((k): k is string => typeof k === 'string'));
  const claimed: CapabilityState = {};
  for (const [key, value] of Object.entries(input)) {
    if (!claimedKeys.has(key)) {
      logger.warn(`Dropping unclaimed capability_state key '${key}' — no capability declares it`);
      continue;
    }
    claimed[key] = value;
  }
  return claimed;
}
