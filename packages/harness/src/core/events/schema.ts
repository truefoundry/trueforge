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
  description: 'Unique identifier for the event (monotonic ULID).',
});

export const AgentParentSchema = z
  .object({
    thread_id: z.string().describe('Parent thread that spawned the child agent.'),
    tool_call_id: z.string().describe('Tool call on the parent thread that created the child.'),
  })
  .openapi('AgentParent');

export const AgentInfoSchema = z
  .object({
    type: z.literal('dynamic').describe('Subagent kind.'),
    name: z.string().describe('Display name of the dynamic subagent.'),
    input: z.string().describe('Input prompt passed to the subagent.'),
    model: z.string().min(1).optional().describe('Optional model override for the subagent.'),
  })
  .openapi('AgentInfo');

export const AgentApprovalDecisionAllowSchema = z
  .object({ status: z.literal('allow').describe('Allow the pending tool call(s).') })
  .openapi('ApprovalAllow');

export const AgentApprovalDecisionDenySchema = z
  .object({
    status: z.literal('deny').describe('Deny the pending tool call(s).'),
    reason: z.string().optional().describe('Optional reason shown to the agent when denied.'),
  })
  .openapi('ApprovalDeny');

export const ApprovalDecisionSchema = z
  .discriminatedUnion('status', [AgentApprovalDecisionAllowSchema, AgentApprovalDecisionDenySchema])
  .openapi('ApprovalDecision');

export const UserToolApprovalMessageSchema = z
  .object({
    type: z.literal(EventType.USER_TOOL_APPROVAL).describe('Client resume after tool.approval_required.'),
    thread_id: z.string().min(1, 'thread_id is required').describe('Thread that owns the pending tool call.'),
    tool_call_id: z.string().min(1, 'tool_call_id is required').describe('Tool call id being approved or denied.'),
    approval: ApprovalDecisionSchema,
  })
  .openapi('UserToolApprovalEvent');

export const UserToolResponseMessageSchema = z
  .object({
    type: z.literal(EventType.USER_TOOL_RESPONSE).describe('Client resume after tool.response_required.'),
    thread_id: z.string().min(1, 'thread_id is required').describe('Thread that owns the pending tool call.'),
    tool_call_id: z.string().min(1, 'tool_call_id is required').describe('Tool call id receiving the client response.'),
    content: z.string().min(1, 'content cannot be empty').describe('Client-side tool result content.'),
  })
  .openapi('UserToolResponseEvent');

export const TextContentPartSchema = z
  .object({
    type: z.literal('text').describe('Text content part.'),
    text: z.string().describe('Plain-text content.'),
  })
  .openapi('TextContent');
export type TextContentPart = z.infer<typeof TextContentPartSchema>;

export const FileContentPartSchema = z
  .object({
    type: z.literal('file').describe('File attachment content part.'),
    name: z.string().describe('Filename presented to the agent.'),
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
    type: z.literal(EventType.USER_MESSAGE).describe('User message input item.'),
    content: z
      .union([z.string(), z.array(UserContentPartSchema)])
      .describe('Plain string or structured text/file content parts.'),
  })
  .openapi('UserMessage');
export type AgentInputUserMessage = z.infer<typeof AgentInputUserMessageSchema>;

// persisted to redis - thread_id is stripped
export const AgentApprovalDecisionMessageSchema = UserToolApprovalMessageSchema.omit({
  thread_id: true,
});

export const InputTokensBreakdownSchema = z.object({
  harness: z.number().int().nonnegative().describe('Tokens attributed to harness system framing.'),
  skills: z.number().int().nonnegative().describe('Tokens attributed to skill instructions.'),
  instructions: z.number().int().nonnegative().describe('Tokens attributed to agent instructions.'),
  tool_definitions: z.number().int().nonnegative().describe('Tokens attributed to tool schemas.'),
  messages: z.number().int().nonnegative().describe('Tokens attributed to conversation messages.'),
});

export const ModelMessageUsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative().describe('Input tokens for this model call.'),
    output_tokens: z.number().int().nonnegative().describe('Output tokens for this model call.'),
    cache_read_tokens: z.number().int().nonnegative().optional().describe('Optional cache-read tokens.'),
    cache_write_tokens: z.number().int().nonnegative().optional().describe('Optional cache-write tokens.'),
    input_tokens_breakdown: InputTokensBreakdownSchema,
  })
  .openapi('ModelMessageUsage');

export const ModelMessageEventSchema = EnrichedAssistantMessageSchema.omit({ role: true })
  .extend({
    type: z.literal(EventType.MODEL_MESSAGE).describe('Complete assistant model message.'),
    id: EventIdSchema,
    thread_id: z.string().describe('Thread that emitted this message (`main` for the root agent).'),
    finish_reason: z
      .union([FinishReasonSchema, z.null()])
      .optional()
      .describe('Model finish reason; null when the provider omitted it.'),
    created_at: z.string().describe('ISO 8601 event timestamp.'),
    usage: ModelMessageUsageSchema.optional(),
  })
  .openapi('ModelMessageEvent');

export const ModelMessageDeltaEventSchema = ExtendedChunkDeltaSchema.omit({
  role: true,
  function_call: true,
  thinking_blocks: true,
})
  .extend({
    type: z.literal(EventType.MODEL_MESSAGE_DELTA).describe('Streaming delta for a model.message.'),
    id: EventIdSchema,
    thread_id: z.string().describe('Thread that emitted this delta.'),
    created_at: z.string().optional().describe('Optional ISO 8601 event timestamp.'),
    finish_reason: z
      .union([FinishReasonSchema, z.null()])
      .optional()
      .describe('Finish reason when this delta completes the stream.'),
    usage: ModelMessageUsageSchema.optional(),
  })
  .openapi('ModelMessageDeltaEvent');

export const ToolResponseEventSchema = LLMToolMessageSchema.omit({ role: true })
  .extend({
    type: z.literal(EventType.TOOL_RESPONSE).describe('Result of a tool execution.'),
    id: EventIdSchema,
    thread_id: z.string().describe('Thread that owns the tool call.'),
    created_at: z.string().describe('ISO 8601 event timestamp.'),
  })
  .openapi('ToolResponseEvent');

export const ThreadCreatedEventSchema = z
  .object({
    type: z.literal(EventType.THREAD_CREATED).describe('A dynamic subagent thread was created.'),
    id: EventIdSchema,
    agent_info: AgentInfoSchema,
    created_at: z.string().describe('ISO 8601 event timestamp.'),
    parent: AgentParentSchema,
    thread_id: z.string().describe('Id of the new thread.'),
    title: z.string().describe('Human-readable thread title.'),
  })
  .openapi('ThreadCreatedEvent');

export const ThreadStateDoneSchema = z
  .object({
    status: z.literal('done').describe('Thread completed successfully.'),
    output: ModelMessageEventSchema,
  })
  .openapi('ThreadStateDone');

export const ThreadStateErrorSchema = z
  .object({
    status: z.literal('error').describe('Thread ended with an error.'),
    error: z.string().describe('Human-readable error message.'),
    output: ModelMessageEventSchema.optional(),
  })
  .openapi('ThreadStateError');

export const ThreadStateSchema = z
  .discriminatedUnion('status', [ThreadStateDoneSchema, ThreadStateErrorSchema])
  .openapi('ThreadState');

export const BaseThreadDoneEventSchema = z
  .object({
    parent: AgentParentSchema.optional(),
    thread_id: z.string().describe('Thread that finished.'),
    title: z.string().describe('Human-readable thread title.'),
  })
  .openapi('BaseThreadDoneEvent');

export const ThreadDoneEventSchema = BaseThreadDoneEventSchema.extend({
  type: z.literal(EventType.THREAD_DONE).describe('A thread reached a terminal state.'),
  id: EventIdSchema,
  created_at: z.string().describe('ISO 8601 event timestamp.'),
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
    id: z.string().describe('Internal MCP server id.'),
    name: z.string().describe('Configured MCP server name.'),
    auth_url: z.string().describe('URL the user must visit to complete OAuth for this server.'),
  })
  .openapi('MCPServerAuthInfo');

export const BaseMCPAuthRequiredEventSchema = z
  .object({
    id: EventIdSchema,
    created_at: z.string().describe('ISO 8601 event timestamp.'),
    // This is a run-level event, not tied to a single thread.
    thread_id: z.string().nullable().describe('Always null — this is a run-level event.'),
  })
  .openapi('BaseMCPAuthRequiredEvent');

export const MCPAuthRequiredEventSchema = BaseMCPAuthRequiredEventSchema.extend({
  type: z.literal(EventType.MCP_AUTH_REQUIRED).describe('One or more MCP servers need OAuth before tools can run.'),
  mcp_servers: z.array(MCPServerAuthInfoSchema).describe('Servers that need authorization, each with an auth_url.'),
}).openapi('MCPAuthRequiredEvent');

export const MCPServerInitInfoSchema = z
  .object({
    id: z.string().describe('Internal MCP server id.'),
    name: z.string().describe('Configured MCP server name.'),
    session_id: z.string().optional().describe('Optional MCP session id from the transport.'),
    transport_type: z
      .enum(['streamable-http', 'sse'])
      .optional()
      .describe('Transport used to connect to the MCP server.'),
  })
  .openapi('MCPServerInitInfo');

export const MCPInitializeEventSchema = z
  .object({
    type: z.literal(EventType.MCP_INITIALIZE).describe('MCP server(s) initialized for this turn.'),
    id: EventIdSchema,
    created_at: z.string().describe('ISO 8601 event timestamp.'),
    thread_id: z.string().describe('Thread that triggered initialization.'),
    mcp_servers: z.array(MCPServerInitInfoSchema).describe('Servers that were initialized.'),
  })
  .openapi('MCPInitializeEvent');

export const SandboxCreatedEventSchema = z
  .object({
    type: z.literal(EventType.SANDBOX_CREATED).describe('A sandbox was created for this session.'),
    id: EventIdSchema,
    created_at: z.string().describe('ISO 8601 event timestamp.'),
    sandbox_id: z.string().describe('Provider sandbox id.'),
    // This is a run-level event, sandbox once created is reused by all threads,
    // and future turns as well.
    thread_id: z.string().nullable().describe('Always null — sandbox is session-scoped.'),
  })
  .openapi('SandboxCreatedEvent');

export const ToolCallRefSchema = z
  .object({
    id: z.string().describe('Tool call id awaiting action.'),
    source_event_id: z.string().describe('Event id of the model.message that requested the tool call.'),
  })
  .openapi('ToolCallRef');

export const ToolApprovalRequiredEventSchema = z
  .object({
    type: z.literal(EventType.TOOL_APPROVAL_REQUIRED).describe('One or more tool calls need human approval.'),
    id: EventIdSchema,
    created_at: z.string().describe('ISO 8601 event timestamp.'),
    thread_id: z.string().describe('Thread that owns the pending tool calls.'),
    tool_calls: z.array(ToolCallRefSchema).describe('Tool calls waiting for approval.'),
  })
  .openapi('ToolApprovalRequiredEvent');

export const ToolResponseRequiredEventSchema = z
  .object({
    type: z
      .literal(EventType.TOOL_RESPONSE_REQUIRED)
      .describe('One or more client-side tool calls need a user/tool response.'),
    id: EventIdSchema,
    created_at: z.string().describe('ISO 8601 event timestamp.'),
    thread_id: z.string().describe('Thread that owns the pending tool calls.'),
    tool_calls: z.array(ToolCallRefSchema).describe('Tool calls waiting for a client response.'),
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
