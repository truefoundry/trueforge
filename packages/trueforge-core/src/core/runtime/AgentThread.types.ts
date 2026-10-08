import type { Logger } from 'winston';
import { z } from 'zod';
import type { AgentCapability, CapabilityState, JsonValue } from '../capabilities/AgentCapability';
import type { RegisteredPassthroughEvent, WithRegisteredPassthrough } from '../events/PassthroughEvents';
import type {
  AgentInfo,
  AgentOutputEvent,
  AgentParent,
  ApprovalDecisionMessage,
  BaseMCPAuthRequiredEvent,
  InputUserMessage,
  MCPInitializeEvent,
  MCPServerAuthInfo,
  MCPServerInitInfo,
  ModelMessageDeltaEvent,
  ModelMessageEvent,
  SandboxCreatedEvent,
  ThreadCreatedEvent,
  ThreadOverwriteContextEvent,
  ThreadStateError,
  ToolApprovalRequiredEvent,
  ToolResponseEvent,
  ToolResponseRequiredEvent,
  TurnUserEvent,
  UserMCPAuthContinueEvent,
  UserToolApprovalEvent,
  UserToolResponseEvent,
} from '../events/schema';
import type { InternalEnrichedAssistantMessage, LLMToolMessage, LLMUserMessage } from '../llm/LLMTypes';
import type { HarnessSandbox } from '../sandbox/Sandbox';
import type { AgentTracing } from '../tracing/AgentTracing';
import type { AgentDefinition } from './AgentDefinition';
import type { CurrentContextUsage } from './contextUsage';

export type { AgentInfo, AgentParent };

/** Canonical string constants for internal (non-wire) orchestration event `type` fields. */
export const InternalEventType = {
  AGENT_CREATE_SUBAGENT: 'internal.agent.create_subagent',
  AGENT_CONTEXT_APPEND: 'internal.agent.context.append',
  AGENT_DONE: 'internal.agent.done',
  // Atomic commit of one applied batch of user events.
  USER_EVENTS_COMMIT: 'internal.user_events.commit',
  // TODO(agent): revisit broader internal.* naming scheme for harness-only event types.
  PASSTHROUGH: 'agent.passthrough',
  MCP_AUTH_REQUIRED: 'internal.mcp.auth_required',
  MCP_AUTH_CONTINUE: 'internal.mcp.auth_continue',
  CAPABILITY_STATE: 'internal.capability.state',
  // Turn lifecycle transition (paused ↔ running).
  TURN_STATE: 'internal.turn.state',
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

export type InternalMCPAuthRequiredEvent = Omit<BaseMCPAuthRequiredEvent, 'thread_id'> & {
  type: typeof InternalEventType.MCP_AUTH_REQUIRED;
  thread_id: string;
  mcp_servers: MCPServerAuthInfo[];
};

export interface InternalMCPAuthContinueEvent {
  type: typeof InternalEventType.MCP_AUTH_CONTINUE;
  event: UserMCPAuthContinueEvent;
  thread_ids: string[];
}

export type SubAgentCompletion =
  | { type: 'done'; output: ModelMessageEvent; send_to_parent: LLMToolMessage }
  | { type: 'error'; output: ModelMessageEvent; error_message: string; send_to_parent: LLMToolMessage }
  | { type: 'cancelled'; reason: string; send_to_parent: LLMToolMessage };

export type InternalMainThreadDoneEvent = {
  type: typeof InternalEventType.AGENT_DONE;
  thread_id: string;
  title: string;
  parent?: undefined; // TODO (chiragjn): we should drop this field
} & (
  | { status: 'done'; output: ModelMessageEvent }
  | { status: 'error'; error: string; output?: ModelMessageEvent | undefined }
);

export type InternalChildThreadDoneEvent = {
  type: typeof InternalEventType.AGENT_DONE;
  thread_id: string;
  title: string;
  parent: AgentParent;
} & (
  | { status: 'done'; output: ModelMessageEvent; send_to_parent: LLMToolMessage }
  | { status: 'error'; error: string; output?: ModelMessageEvent | undefined; send_to_parent: LLMToolMessage }
  | { status: 'cancelled'; reason: string; send_to_parent: LLMToolMessage }
);

export type InternalThreadDoneEvent = InternalMainThreadDoneEvent | InternalChildThreadDoneEvent;

export type LLMContextMessage = LLMUserMessage | InternalEnrichedAssistantMessage | LLMToolMessage;

export type ContextMessage = LLMContextMessage | ApprovalDecisionMessage;

export interface AgentThreadCreateSubAgent {
  type: typeof InternalEventType.AGENT_CREATE_SUBAGENT;
  thread_id: string;
  tool_call_id: string;
  agent_info: AgentInfo;
}

export interface AgentThreadAppendContext {
  type: typeof InternalEventType.AGENT_CONTEXT_APPEND;
  thread_id: string;
  context: ContextMessage[];
  output: AgentOutputEvent[];
  current_context_usage?: CurrentContextUsage | undefined;
  completion?: SubAgentCompletion | undefined;
}

export interface UserEventsCommitEvent {
  type: typeof InternalEventType.USER_EVENTS_COMMIT;
  context_appends: AgentThreadAppendContext[];
  mcp_servers_patches: MCPServerInitInfo[];
  applied_user_events: TurnUserEvent[];
}

/**
 * Single runtime send item (no internal LLM tool messages). Decisions are in event form — their ids
 * are seeded at the send boundary (HTTP handler / createTurn `toSendBatch`) and reused downstream.
 */
export type AgentSendInput = UserToolApprovalEvent | UserToolResponseEvent | InputUserMessage;

/**
 * Homogeneous send batch: all user messages, or all approval/tool-response events (id-seeded).
 * Mixed batches are rejected at the HTTP/orchestrator boundary.
 */
export type AgentThreadSendBatch = InputUserMessage[] | (UserToolApprovalEvent | UserToolResponseEvent)[];

export type AgentThreadEvent =
  | ModelMessageEvent
  | ModelMessageDeltaEvent
  | ToolResponseEvent
  | AgentThreadCreateSubAgent
  | AgentThreadAppendContext
  | ThreadOverwriteContextEvent
  | InternalThreadDoneEvent
  | InternalMCPAuthRequiredEvent
  | InternalMCPAuthContinueEvent
  | InternalCapabilityStateEvent
  | MCPInitializeEvent
  | SandboxCreatedEvent
  | ToolApprovalRequiredEvent
  | ToolResponseRequiredEvent
  | UserEventsCommitEvent
  | InternalPassthroughEvent;

export type ApplyUserEventsOutput = AgentThreadAppendContext | UserEventsCommitEvent;

/** A turn-level non-terminal transition emitted by the executor loop when it parks/resumes. */
export interface InternalTurnStateEvent {
  type: typeof InternalEventType.TURN_STATE;
  transition: { status: 'paused' } | { status: 'running' };
}

export type AgentThreadExecutionEvent =
  | WithRegisteredPassthrough<ThreadCreatedEvent | Exclude<AgentThreadEvent, InternalPassthroughEvent>>
  | InternalTurnStateEvent;

export interface AgentThreadExecutionResult {
  status: 'done';
  output: ModelMessageEvent | null;
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
  completion: SubAgentCompletion | null;
  pending_mcp_auth: boolean;
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
  preComputedCompletion?: SubAgentCompletion | undefined;
  sandbox?: HarnessSandbox | undefined;
  capabilities?: readonly AgentCapability[] | undefined;
  /**
   * Previous turn's capability_state for hydration. Optional — omit on first
   * turn / fresh sub-agent. The constructor is the sole hydration site.
   */
  capabilityState?: CapabilityState | undefined;
  tracing: AgentTracing;
  logger: Logger;
}
