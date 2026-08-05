// Harness wire-format event schemas (OpenAPI-decorated Zod).
import { z } from '@hono/zod-openapi';
import { monotonicFactory } from 'ulid';
import {
  CompletionUsageSchema,
  EnrichedAssistantMessageSchema,
  ExtendedChunkDeltaSchema,
  FinishReasonSchema,
  InternalEnrichedAssistantMessageSchema,
  LLMToolMessageSchema,
  LLMUserMessageSchema,
} from '../llm/LLMTypes';
import { CurrentContextUsageSchema } from '../runtime/contextUsage';

/**
 * Process-local monotonic ULIDs preserve event creation order, including
 * multiple events created in the same millisecond. A turn has one sequential
 * writer, so this is the durable event order key.
 *
 * @see https://github.com/ulid/spec#monotonicity
 */
const monotonicUlid = monotonicFactory();

export function newEventId(): string {
  return monotonicUlid().toLowerCase();
}

/** Canonical string constants for harness wire-level and user-input event `type` fields. */
export const EventType = {
  AGENT_CONTEXT_OVERWRITE: 'agent.context.overwrite',
  MCP_AUTH_REQUIRED: 'mcp.auth_required',
  MCP_INITIALIZE: 'mcp.initialize',
  MODEL_MESSAGE: 'model.message',
  MODEL_MESSAGE_DELTA: 'model.message.delta',
  SANDBOX_CREATED: 'sandbox.created',
  THREAD_CREATED: 'thread.created',
  THREAD_DONE: 'thread.done',
  TOOL_RESPONSE: 'tool.response',
  TOOL_APPROVAL_REQUIRED: 'tool.approval_required',
  TOOL_RESPONSE_REQUIRED: 'tool.response_required',
  USER_TOOL_APPROVAL: 'user.tool_approval',
  USER_TOOL_RESPONSE: 'user.tool_response',
  USER_MESSAGE: 'user.message',
} as const;

export const EventIdSchema = z.string().openapi({
  description: 'Unique identifier for the event',
});

export const AgentParentSchema = z
  .object({
    thread_id: z.string(),
    tool_call_id: z.string(),
  })
  .openapi('AgentParent');

export const AgentInfoSchema = z
  .object({
    type: z.literal('dynamic'),
    name: z.string(),
    input: z.string(),
    model: z.string().min(1).optional(),
  })
  .openapi('AgentInfo');

export const AgentApprovalDecisionAllowSchema = z.object({ status: z.literal('allow') }).openapi('ApprovalAllow');

export const AgentApprovalDecisionDenySchema = z
  .object({ status: z.literal('deny'), reason: z.string().optional() })
  .openapi('ApprovalDeny');

export const ApprovalDecisionSchema = z
  .discriminatedUnion('status', [AgentApprovalDecisionAllowSchema, AgentApprovalDecisionDenySchema])
  .openapi('ApprovalDecision');

export const UserToolApprovalMessageSchema = z
  .object({
    type: z.literal(EventType.USER_TOOL_APPROVAL),
    thread_id: z.string().min(1, 'thread_id is required'),
    tool_call_id: z.string().min(1, 'tool_call_id is required'),
    approval: ApprovalDecisionSchema,
  })
  .openapi('UserToolApprovalEvent');

export const UserToolResponseMessageSchema = z
  .object({
    type: z.literal(EventType.USER_TOOL_RESPONSE),
    thread_id: z.string().min(1, 'thread_id is required'),
    tool_call_id: z.string().min(1, 'tool_call_id is required'),
    content: z.string().min(1, 'content cannot be empty'),
  })
  .openapi('UserToolResponseEvent');

export const TextContentPartSchema = z
  .object({
    type: z.literal('text'),
    text: z.string(),
  })
  .openapi('TextContent');
export type TextContentPart = z.infer<typeof TextContentPartSchema>;

export const FileContentPartSchema = z
  .object({
    type: z.literal('file'),
    name: z.string(),
    data: z.string().describe('Data URI: `data:<mime>;base64,<payload>`. MIME type is parsed from the URI.'),
  })
  .openapi('FileContent');
export type FileContentPart = z.infer<typeof FileContentPartSchema>;

export const UserContentPartSchema = z
  .discriminatedUnion('type', [TextContentPartSchema, FileContentPartSchema])
  .openapi('UserMessageContentItem');
export type UserContentPart = z.infer<typeof UserContentPartSchema>;

export const AgentInputUserMessageSchema = z
  .object({
    type: z.literal(EventType.USER_MESSAGE),
    content: z.union([z.string(), z.array(UserContentPartSchema)]),
  })
  .openapi('UserMessage');
export type AgentInputUserMessage = z.infer<typeof AgentInputUserMessageSchema>;

// persisted to redis - thread_id is stripped
export const AgentApprovalDecisionMessageSchema = UserToolApprovalMessageSchema.omit({
  thread_id: true,
});

export const InputTokensBreakdownSchema = z.object({
  harness: z.number().int().nonnegative(),
  skills: z.number().int().nonnegative(),
  instructions: z.number().int().nonnegative(),
  tool_definitions: z.number().int().nonnegative(),
  messages: z.number().int().nonnegative(),
});

export const ModelMessageUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_read_tokens: z.number().int().nonnegative().optional(),
    cache_write_tokens: z.number().int().nonnegative().optional(),
    input_tokens_breakdown: InputTokensBreakdownSchema,
  })
  .openapi('ModelMessageUsage');

export const ModelMessageEventSchema = EnrichedAssistantMessageSchema.omit({ role: true })
  .extend({
    type: z.literal(EventType.MODEL_MESSAGE),
    id: EventIdSchema,
    thread_id: z.string(),
    finish_reason: z.union([FinishReasonSchema, z.null()]).optional(),
    created_at: z.string(),
    usage: ModelMessageUsageSchema.optional(),
  })
  .openapi('ModelMessageEvent');

export const ModelMessageDeltaEventSchema = ExtendedChunkDeltaSchema.omit({
  role: true,
  function_call: true,
  thinking_blocks: true,
})
  .extend({
    type: z.literal(EventType.MODEL_MESSAGE_DELTA),
    id: EventIdSchema,
    thread_id: z.string(),
    created_at: z.string().optional(),
    finish_reason: z.union([FinishReasonSchema, z.null()]).optional(),
    usage: ModelMessageUsageSchema.optional(),
  })
  .openapi('ModelMessageDeltaEvent');

export const ToolResponseEventSchema = LLMToolMessageSchema.omit({ role: true })
  .extend({
    type: z.literal(EventType.TOOL_RESPONSE),
    id: EventIdSchema,
    thread_id: z.string(),
    created_at: z.string(),
  })
  .openapi('ToolResponseEvent');

export const ThreadCreatedEventSchema = z
  .object({
    type: z.literal(EventType.THREAD_CREATED),
    id: EventIdSchema,
    agent_info: AgentInfoSchema,
    created_at: z.string(),
    parent: AgentParentSchema,
    thread_id: z.string(),
    title: z.string(),
  })
  .openapi('ThreadCreatedEvent');

export const ThreadStateDoneSchema = z
  .object({
    status: z.literal('done'),
    output: ModelMessageEventSchema,
  })
  .openapi('ThreadStateDone');

export const ThreadStateErrorSchema = z
  .object({
    status: z.literal('error'),
    error: z.string(),
    output: ModelMessageEventSchema.optional(),
  })
  .openapi('ThreadStateError');

export const ThreadStateSchema = z
  .discriminatedUnion('status', [ThreadStateDoneSchema, ThreadStateErrorSchema])
  .openapi('ThreadState');

export const BaseThreadDoneEventSchema = z
  .object({
    parent: AgentParentSchema.optional(),
    thread_id: z.string(),
    title: z.string(),
  })
  .openapi('BaseThreadDoneEvent');

export const ThreadDoneEventSchema = BaseThreadDoneEventSchema.extend({
  type: z.literal(EventType.THREAD_DONE),
  id: EventIdSchema,
  created_at: z.string(),
  state: ThreadStateSchema,
}).openapi('ThreadDoneEvent');

const ContextMessageSchema = z.union([
  LLMUserMessageSchema,
  InternalEnrichedAssistantMessageSchema,
  LLMToolMessageSchema,
  AgentApprovalDecisionMessageSchema,
]);

export const ThreadOverwriteContextEventSchema = z.object({
  // TODO(agent): This will be used by summarization.

  // TODO(agent): For summarization, we will add a AgentExecutionContextSummarizationStart and AgentExecutionContextSummarizationEnd
  // event. Summarization can take some time, this will ensure that the customer is aware of what is happening.
  type: z.literal(EventType.AGENT_CONTEXT_OVERWRITE),
  id: EventIdSchema,
  created_at: z.string(),
  thread_id: z.string(),

  // NOTE: add other reasons here.
  reason: z.literal('compaction'),
  context: z.array(ContextMessageSchema),
  current_context_usage: CurrentContextUsageSchema,
  usage: CompletionUsageSchema,
});

export const MCPServerAuthInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    auth_url: z.string(),
  })
  .openapi('MCPServerAuthInfo');

export const BaseMCPAuthRequiredEventSchema = z
  .object({
    id: EventIdSchema,
    created_at: z.string(),
    // This is a run-level event, not tied to a single thread.
    thread_id: z.string().nullable(),
  })
  .openapi('BaseMCPAuthRequiredEvent');

export const MCPAuthRequiredEventSchema = BaseMCPAuthRequiredEventSchema.extend({
  type: z.literal(EventType.MCP_AUTH_REQUIRED),
  mcp_servers: z.array(MCPServerAuthInfoSchema),
}).openapi('MCPAuthRequiredEvent');

export const MCPServerInitInfoSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    session_id: z.string().optional(),
    transport_type: z.enum(['streamable-http', 'sse']).optional(),
  })
  .openapi('MCPServerInitInfo');

export const MCPInitializeEventSchema = z
  .object({
    type: z.literal(EventType.MCP_INITIALIZE),
    id: EventIdSchema,
    created_at: z.string(),
    thread_id: z.string(),
    mcp_servers: z.array(MCPServerInitInfoSchema),
  })
  .openapi('MCPInitializeEvent');

export const SandboxCreatedEventSchema = z
  .object({
    type: z.literal(EventType.SANDBOX_CREATED),
    id: EventIdSchema,
    created_at: z.string(),
    sandbox_id: z.string(),
    // This is a run-level event, sandbox once created is reused by all threads,
    // and future turns as well.
    thread_id: z.string().nullable(),
  })
  .openapi('SandboxCreatedEvent');

export const ToolCallRefSchema = z
  .object({
    id: z.string(),
    source_event_id: z.string(),
  })
  .openapi('ToolCallRef');

export const ToolApprovalRequiredEventSchema = z
  .object({
    type: z.literal(EventType.TOOL_APPROVAL_REQUIRED),
    id: EventIdSchema,
    created_at: z.string(),
    thread_id: z.string(),
    tool_calls: z.array(ToolCallRefSchema),
  })
  .openapi('ToolApprovalRequiredEvent');

export const ToolResponseRequiredEventSchema = z
  .object({
    type: z.literal(EventType.TOOL_RESPONSE_REQUIRED),
    id: EventIdSchema,
    created_at: z.string(),
    thread_id: z.string(),
    tool_calls: z.array(ToolCallRefSchema),
  })
  .openapi('ToolResponseRequiredEvent');

export const ActionRequiredEventSchema = z
  .discriminatedUnion('type', [
    ToolApprovalRequiredEventSchema,
    ToolResponseRequiredEventSchema,
    MCPAuthRequiredEventSchema,
  ])
  .openapi('ActionRequiredEvent');

/** Neutral harness output-event membership (not an HTTP/OpenAPI AgentResponse aggregate). */
export const AgentOutputEventSchema = z.discriminatedUnion('type', [
  ModelMessageEventSchema,
  ToolResponseEventSchema,
  ThreadCreatedEventSchema,
  ThreadDoneEventSchema,
  MCPAuthRequiredEventSchema,
  MCPInitializeEventSchema,
  SandboxCreatedEventSchema,
  ToolApprovalRequiredEventSchema,
  ToolResponseRequiredEventSchema,
]);

export type AgentParent = z.infer<typeof AgentParentSchema>;
export type AgentInfo = z.infer<typeof AgentInfoSchema>;
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>;
export type UserToolApprovalMessage = z.infer<typeof UserToolApprovalMessageSchema>;
export type UserToolResponseMessage = z.infer<typeof UserToolResponseMessageSchema>;
export type AgentApprovalDecisionMessage = z.infer<typeof AgentApprovalDecisionMessageSchema>;
export type InputTokensBreakdown = z.infer<typeof InputTokensBreakdownSchema>;
export type ModelMessageUsage = z.infer<typeof ModelMessageUsageSchema>;
export type ModelMessageEvent = z.infer<typeof ModelMessageEventSchema>;
export type ModelMessageDeltaEvent = z.infer<typeof ModelMessageDeltaEventSchema>;
export type ToolResponseEvent = z.infer<typeof ToolResponseEventSchema>;
export type ThreadCreatedEvent = z.infer<typeof ThreadCreatedEventSchema>;
export type ThreadStateError = z.infer<typeof ThreadStateErrorSchema>;
export type ThreadState = z.infer<typeof ThreadStateSchema>;
export type BaseThreadDoneEvent = z.infer<typeof BaseThreadDoneEventSchema>;
export type ThreadDoneEvent = z.infer<typeof ThreadDoneEventSchema>;
export type ThreadOverwriteContextEvent = z.infer<typeof ThreadOverwriteContextEventSchema>;
export type BaseMCPAuthRequiredEvent = z.infer<typeof BaseMCPAuthRequiredEventSchema>;
export type MCPServerAuthInfo = z.infer<typeof MCPServerAuthInfoSchema>;
export type MCPAuthRequiredEvent = z.infer<typeof MCPAuthRequiredEventSchema>;
export type MCPServerInitInfo = z.infer<typeof MCPServerInitInfoSchema>;
export type MCPInitializeEvent = z.infer<typeof MCPInitializeEventSchema>;
export type SandboxCreatedEvent = z.infer<typeof SandboxCreatedEventSchema>;
export type ToolApprovalRequiredEvent = z.infer<typeof ToolApprovalRequiredEventSchema>;
export type ToolResponseRequiredEvent = z.infer<typeof ToolResponseRequiredEventSchema>;
export type ActionRequiredEvent = z.infer<typeof ActionRequiredEventSchema>;
export type AgentOutputEvent = z.infer<typeof AgentOutputEventSchema>;
