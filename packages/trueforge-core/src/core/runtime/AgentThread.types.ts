import type { Logger } from 'winston';
import { z } from 'zod';
import type { AgentCapability, CapabilityState, JsonValue } from '../capabilities/AgentCapability';
import type { RegisteredPassthroughEvent, WithRegisteredPassthrough } from '../events/PassthroughEvents';
import type {
  AgentApprovalDecisionMessage,
  AgentInfo,
  AgentInputUserMessage,
  AgentOutputEvent,
  AgentParent,
  BaseMCPAuthRequiredEvent,
  BaseThreadDoneEvent,
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
  TurnUserToolEvent,
  UserToolApprovalMessage,
  UserToolResponseMessage,
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

/**
 * Atomic commit of one applied batch of user events — the unit of "user events consumed". Groups
 * every store write that must land together so TurnHandle can persist them in one transaction (once
 * a DB store exists; sequential writes until then): context appends, approval-marker overwrites, an
 * MCP server patch (policy only), the per-inbound-event output events, and the ids to mark consumed.
 *
 * Produced once per application step — by the thread for a decision-drain (single thread), and by the
 * orchestrator for a policy apply (fans across threads, so `context_overwrites` may span thread ids).
 * `applied_user_events` carries exactly one entry per inbound user event (the consumption handle),
 * in output (id + created_at) form, to be streamed and appended to the event log. Empty arrays are
 * skipped by the consumer.
 */
export interface UserEventsCommitEvent {
  type: typeof InternalEventType.USER_EVENTS_COMMIT;
  context_appends: AgentThreadAppendContext[];
  context_overwrites: ThreadOverwriteContextEvent[];
  mcp_patch: MCPServerInitInfo[];
  applied_user_events: TurnUserToolEvent[];
  consumed_event_ids: string[];
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

/**
 * Terminal result of an executor run. The executor parks internally while paused (surfacing
 * pause/resume via the {@link InternalTurnStateEvent} stream), so it only ever *returns* once the
 * run has finished or the root agent errored — hence a single 'done' shape, never 'paused'.
 */
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
