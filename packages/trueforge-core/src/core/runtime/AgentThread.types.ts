import type { Logger } from 'winston';
import { z } from 'zod';
import type { AgentCapability, CapabilityState, JsonValue } from '../capabilities/AgentCapability';
import type { RegisteredPassthroughEvent, WithRegisteredPassthrough } from '../events/PassthroughEvents';
import type {
  ActionRequiredEvent,
  AgentApprovalDecisionMessage,
  AgentInfo,
  AgentInputUserMessage,
  AgentOutputEvent,
  AgentParent,
  BaseMCPAuthRequiredEvent,
  BaseThreadDoneEvent,
  MCPInitializeEvent,
  MCPServerAuthInfo,
  ModelMessageDeltaEvent,
  ModelMessageEvent,
  SandboxCreatedEvent,
  ThreadCreatedEvent,
  ThreadOverwriteContextEvent,
  ThreadStateError,
  ToolApprovalRequiredEvent,
  ToolResponseEvent,
  ToolResponseRequiredEvent,
  UserToolApprovalMessage,
  UserToolResponseMessage,
} from '../events/schema';
import type { InternalEnrichedAssistantMessage, LLMToolMessage, LLMUserMessage } from '../llm/LLMTypes';
import type { Sandbox } from '../sandbox/Sandbox';
import type { AgentTracing } from '../tracing/AgentTracing';
import type { AgentDefinition } from './AgentDefinition';
import type { CurrentContextUsage } from './contextUsage';

export type { AgentInfo, AgentParent };

/** Canonical string constants for internal (non-wire) orchestration event `type` fields. */
export const InternalEventType = {
  AGENT_CREATE_SUBAGENT: 'internal.agent.create_subagent',
  AGENT_CONTEXT_APPEND: 'internal.agent.context.append',
  AGENT_DONE: 'internal.agent.done',
  // TODO(agent): revisit broader internal.* naming scheme for harness-only event types.
  PASSTHROUGH: 'agent.passthrough',
  MCP_AUTH_REQUIRED: 'internal.mcp.auth_required',
  CAPABILITY_STATE: 'internal.capability.state',
} as const;

/**
 * Cross-turn capability KV write. Processors emit without `thread_id`
 * ({@link AgentContextProcessorOutput}); AgentThread stamps `thread_id` when yielding.
 */
export interface InternalCapabilityStateEvent {
  type: typeof InternalEventType.CAPABILITY_STATE;
  thread_id: string;
  key: string;
  state: JsonValue;
}

export interface InternalPassthroughEvent {
  type: typeof InternalEventType.PASSTHROUGH;
  event: RegisteredPassthroughEvent;
}

export const InternalPassthroughEventSchema: z.ZodType<InternalPassthroughEvent> = z.object({
  type: z.literal(InternalEventType.PASSTHROUGH),
  event: z.custom<RegisteredPassthroughEvent>(),
});

export type InternalMCPServerAuthInfo = MCPServerAuthInfo & {
  thread_ids: string[];
};

export type InternalMCPAuthRequiredEvent = BaseMCPAuthRequiredEvent & {
  type: typeof InternalEventType.MCP_AUTH_REQUIRED;
  mcp_servers: InternalMCPServerAuthInfo[];
};

export type InternalThreadDoneEvent = BaseThreadDoneEvent & {
  type: typeof InternalEventType.AGENT_DONE;
  send_to_parent: LLMToolMessage | undefined;
} & ({ status: 'done'; output: ModelMessageEvent } | { status: 'error'; error: string; output?: ModelMessageEvent });

export type LLMContextMessage = LLMUserMessage | InternalEnrichedAssistantMessage | LLMToolMessage;

export type ContextMessage = LLMContextMessage | AgentApprovalDecisionMessage;

export interface AgentThreadCreateSubAgent {
  type: typeof InternalEventType.AGENT_CREATE_SUBAGENT;
  thread_id: string;
  tool_call_id: string;
  agent_info: AgentInfo;
}

export interface SubAgentCompletionMarker {
  type: 'done' | 'error';
  output: ModelMessageEvent;
  error_message?: string | undefined;
  send_to_parent: LLMToolMessage;
}

export interface AgentThreadAppendContext {
  type: typeof InternalEventType.AGENT_CONTEXT_APPEND;
  thread_id: string;
  context: ContextMessage[];
  output: AgentOutputEvent[];
  current_context_usage?: CurrentContextUsage | undefined;
  completion?: SubAgentCompletionMarker | undefined;
}

/** Single public send item (no internal LLM tool messages). */
export type AgentSendInput = UserToolApprovalMessage | UserToolResponseMessage | AgentInputUserMessage;

/**
 * Homogeneous public send batch: all user messages, or all approval/tool-response
 * messages. Mixed batches are rejected at the HTTP/orchestrator boundary.
 */
export type AgentThreadSendBatch = AgentInputUserMessage[] | (UserToolApprovalMessage | UserToolResponseMessage)[];

export type AgentThreadEvent =
  | ModelMessageEvent
  | ModelMessageDeltaEvent
  | ToolResponseEvent
  | AgentThreadCreateSubAgent
  | AgentThreadAppendContext
  | ThreadOverwriteContextEvent
  | InternalThreadDoneEvent
  | InternalMCPAuthRequiredEvent
  | InternalCapabilityStateEvent
  | MCPInitializeEvent
  | SandboxCreatedEvent
  | ToolApprovalRequiredEvent
  | ToolResponseRequiredEvent
  | InternalPassthroughEvent;

export type AgentThreadExecutionEvent = WithRegisteredPassthrough<
  ThreadCreatedEvent | Exclude<AgentThreadEvent, InternalPassthroughEvent>
>;

export interface AgentThreadExecutionResult {
  output: ModelMessageEvent | null;
  required_actions: ActionRequiredEvent[];
  root_agent_error?: Pick<ThreadStateError, 'error' | 'output'> | undefined;
}

/** Public send items plus internal LLM tool messages (child→parent delivery). */
export type AgentThreadRuntimeSendInput = AgentSendInput | LLMToolMessage;

/** Public homogeneous batches or an internal LLM tool-message batch. Not barrel-exported. */
export type AgentThreadRuntimeSendBatch = AgentThreadSendBatch | LLMToolMessage[];

export interface AgentThreadSnapshot {
  thread_id: string;
  context: ContextMessage[];
  current_context_usage: CurrentContextUsage;
  parent: AgentParent | null;
  agent_info: AgentInfo | null;
  completion: SubAgentCompletionMarker | null;
  /** Cross-turn capability KV. Keys: capability.state.key; `tfy.` reserved for builtins. */
  capability_state: CapabilityState | null;
}

export interface AgentThreadConstructorInput {
  definition: AgentDefinition;
  threadId: string;
  title: string;
  parent?: AgentParent | undefined;
  agentInfo?: AgentInfo | undefined;
  context?: ContextMessage[] | undefined;
  currentContextUsage?: CurrentContextUsage | undefined;
  preComputedCompletion?: SubAgentCompletionMarker | undefined;
  sandbox?: Sandbox | undefined;
  capabilities?: readonly AgentCapability[] | undefined;
  /**
   * Previous turn's capability_state for hydration. Optional — omit on first
   * turn / fresh sub-agent. The constructor is the sole hydration site.
   */
  capabilityState?: CapabilityState | undefined;
  tracing: AgentTracing;
  logger: Logger;
}
