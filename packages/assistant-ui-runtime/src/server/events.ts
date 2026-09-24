/**
 * Runtime-owned turn/stream event protocol.
 *
 * Hosts must emit events matching these shapes.
 */

import type {
  NonTerminalTurnState,
  TerminalTurnState,
  TurnInputItem,
  TurnStatePaused,
  TurnStateRunning,
  UserMcpAuthContinueInputEvent,
  UserToolApprovalInputEvent,
  UserToolApprovalPolicyInputEvent,
  UserToolResponseInputEvent,
} from './types.js';

export const EVENT_TYPE = {
  MCP_AUTH_REQUIRED: 'mcp.auth_required',
  MCP_INITIALIZE: 'mcp.initialize',
  MODEL_MESSAGE: 'model.message',
  MODEL_MESSAGE_DELTA: 'model.message.delta',
  SANDBOX_CREATED: 'sandbox.created',
  THREAD_CREATED: 'thread.created',
  THREAD_DONE: 'thread.done',
  TOOL_APPROVAL_REQUIRED: 'tool.approval_required',
  TOOL_RESPONSE: 'tool.response',
  TOOL_RESPONSE_REQUIRED: 'tool.response_required',
  TURN_CREATED: 'turn.created',
  TURN_DONE: 'turn.done',
  TURN_UPDATE: 'turn.update',
  USER_MESSAGE: 'user.message',
  USER_MCP_AUTH_CONTINUE: 'user.mcp_auth_continue',
  USER_TOOL_APPROVAL: 'user.tool_approval',
  USER_TOOL_APPROVAL_POLICY: 'user.tool_approval_policy',
  USER_TOOL_RESPONSE: 'user.tool_response',
} as const;

export const TOOL_INFO_TYPE = {
  MCP: 'mcp',
  TRUEFORGE_SYSTEM: 'trueforge-system',
} as const;

export const SYSTEM_TOOL_NAME = {
  ASK_USER_QUESTION: 'ask_user_question',
  CREATE_SUB_AGENT: 'create_sub_agent',
} as const;

// ---------------------------------------------------------------------------
// Tool call shapes
// ---------------------------------------------------------------------------

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export type ToolInfo =
  | { type: typeof TOOL_INFO_TYPE.TRUEFORGE_SYSTEM; name: string }
  | { type: typeof TOOL_INFO_TYPE.MCP; serverId: string; serverName: string; name: string }
  | { type: string; name?: string };

export interface ToolCall {
  id: string;
  type: 'function';
  function: ToolCallFunction;
  toolInfo?: ToolInfo;
  providerSpecificFields?: Record<string, unknown>;
}

/** Ref used by approval/response-required events. */
export interface ToolCallRef {
  id: string;
  sourceEventId: string;
}

export interface ChunkDeltaToolCall {
  index: number;
  id?: string;
  type?: 'function';
  function?: { name?: string; arguments?: string };
  toolInfo?: ToolInfo;
  providerSpecificFields?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Content events
// ---------------------------------------------------------------------------

export type ModelMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'refusal'; refusal: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ModelMessageEvent {
  type: typeof EVENT_TYPE.MODEL_MESSAGE;
  id: string;
  threadId: string;
  content?: string | ModelMessageContentPart[] | null;
  name?: string;
  refusal?: string | null;
  reasoningContent?: string;
  toolCalls?: ToolCall[];
  finishReason?: string | null;
  createdAt: string;
  usage?: unknown;
}

export interface ModelMessageDeltaEvent {
  type: typeof EVENT_TYPE.MODEL_MESSAGE_DELTA;
  id: string;
  threadId: string;
  content?: string | null;
  refusal?: string | null;
  reasoningContent?: string;
  toolCalls?: ChunkDeltaToolCall[];
  finishReason?: string | null;
  createdAt?: string;
  usage?: unknown;
  /** Extended content-block deltas (image streaming). */
  contentBlocks?: {
    index: number;
    delta: { type: 'text'; text?: string } | { type: 'image_url'; image_url?: { url?: string } };
  }[];
  content_blocks?: {
    index: number;
    delta: { type: 'text'; text?: string } | { type: 'image_url'; image_url?: { url?: string } };
  }[];
}

export interface ToolResponseEvent {
  type: typeof EVENT_TYPE.TOOL_RESPONSE;
  id: string;
  threadId: string;
  toolCallId: string;
  content: string;
  createdAt: string;
}

export interface ToolApprovalRequiredEvent {
  type: typeof EVENT_TYPE.TOOL_APPROVAL_REQUIRED;
  id: string;
  createdAt: string;
  threadId: string;
  toolCalls: ToolCallRef[];
}

export interface ToolResponseRequiredEvent {
  type: typeof EVENT_TYPE.TOOL_RESPONSE_REQUIRED;
  id: string;
  createdAt: string;
  threadId: string;
  toolCalls: ToolCallRef[];
}

export interface AgentInfo {
  type?: string;
  name: string;
  input: string;
  model?: string;
}

export interface AgentParent {
  threadId: string;
  toolCallId: string;
}

export interface ThreadCreatedEvent {
  type: typeof EVENT_TYPE.THREAD_CREATED;
  id: string;
  threadId: string;
  title: string;
  agentInfo: AgentInfo;
  parent: AgentParent;
  createdAt: string;
}

export interface ThreadDoneEvent {
  type: typeof EVENT_TYPE.THREAD_DONE;
  id: string;
  threadId: string;
  title?: string;
  createdAt: string;
  state?: unknown;
}

export interface McpServerAuthInfo {
  id: string;
  name: string;
  authUrl: string;
}

export interface McpAuthRequiredEvent {
  type: typeof EVENT_TYPE.MCP_AUTH_REQUIRED;
  id: string;
  createdAt: string;
  threadId?: string | null;
  mcpServers: McpServerAuthInfo[];
}

export interface SandboxCreatedEvent {
  type: typeof EVENT_TYPE.SANDBOX_CREATED;
  id: string;
  createdAt: string;
  sandboxId: string;
  threadId: string | null;
}

export interface McpInitializeEvent {
  type: typeof EVENT_TYPE.MCP_INITIALIZE;
  id: string;
  createdAt: string;
  threadId: string | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Turn lifecycle events
// ---------------------------------------------------------------------------

export interface TurnCreatedEvent {
  type: typeof EVENT_TYPE.TURN_CREATED;
  id: string;
  turnId: string;
  previousTurnId?: string | null;
  input?: TurnInputItem[];
  state?: TurnStateRunning;
  createdAt: string;
  threadId?: string | null;
}

export interface TurnDoneEvent {
  type: typeof EVENT_TYPE.TURN_DONE;
  id: string;
  state: TerminalTurnState;
  createdAt: string;
  threadId?: string | null;
}

export type TurnUpdateStatePaused = TurnStatePaused;
export type TurnUpdateStateRunning = TurnStateRunning;
export type TurnUpdateState = NonTerminalTurnState;

export interface TurnUpdateEvent {
  type: typeof EVENT_TYPE.TURN_UPDATE;
  id: string;
  state: TurnUpdateState;
  createdAt: string;
  threadId: string | null;
}

interface PersistedInboundEvent {
  id: string;
  createdAt: string;
}

export interface UserToolApprovalEvent extends UserToolApprovalInputEvent, PersistedInboundEvent {}

export interface UserToolApprovalPolicyEvent extends UserToolApprovalPolicyInputEvent, PersistedInboundEvent {}

export interface UserToolResponseEvent extends UserToolResponseInputEvent, PersistedInboundEvent {}

export interface UserMcpAuthContinueEvent extends UserMcpAuthContinueInputEvent, PersistedInboundEvent {}

export type TurnInboundEvent =
  UserToolApprovalEvent | UserToolApprovalPolicyEvent | UserToolResponseEvent | UserMcpAuthContinueEvent;

// ---------------------------------------------------------------------------
// Unions
// ---------------------------------------------------------------------------

/** Events stored in fold buckets (non-delta, non-turn-lifecycle). */
export type TurnEvent =
  | ModelMessageEvent
  | ToolResponseEvent
  | ThreadCreatedEvent
  | ThreadDoneEvent
  | McpAuthRequiredEvent
  | McpInitializeEvent
  | SandboxCreatedEvent
  | ToolApprovalRequiredEvent
  | ToolResponseRequiredEvent
  | TurnInboundEvent;

/** Full streaming event union (includes deltas + turn lifecycle). */
export type TurnStreamingEvent =
  TurnEvent | ModelMessageDeltaEvent | TurnCreatedEvent | TurnUpdateEvent | TurnDoneEvent;

export type ActionRequiredEvent = ToolApprovalRequiredEvent | ToolResponseRequiredEvent | McpAuthRequiredEvent;

/** Durable turn event union; streaming deltas are intentionally excluded. */
export type PersistedTurnEvent = TurnCreatedEvent | TurnUpdateEvent | TurnDoneEvent | TurnEvent;

export interface TurnStreamData<TStreamEvent extends TurnStreamingEvent = TurnStreamingEvent> {
  sequenceNumber: number;
  event: TStreamEvent;
}

/** Session-level event item from `listEvents`. */
export interface SessionEventItem {
  turnId: string;
  event: PersistedTurnEvent;
}

export type DeltaEvents = ModelMessageDeltaEvent;
