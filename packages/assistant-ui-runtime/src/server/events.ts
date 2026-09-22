/**
 * Runtime-owned turn/stream event protocol.
 *
 * Hosts must emit events matching these shapes.
 */

import type { TurnInputItem, TurnState } from './types.js';

// ---------------------------------------------------------------------------
// Tool call shapes
// ---------------------------------------------------------------------------

export interface ToolCallFunction {
  name: string;
  arguments: string;
}

export type ToolInfo =
  | { type: 'trueforge-system'; name: string }
  | { type: 'mcp'; serverId: string; serverName: string; name: string }
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
  type: 'model.message';
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
  type: 'model.message.delta';
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
  type: 'tool.response';
  id: string;
  threadId: string;
  toolCallId: string;
  content: string;
  createdAt: string;
}

export interface ToolApprovalRequiredEvent {
  type: 'tool.approval_required';
  id: string;
  createdAt: string;
  threadId: string;
  toolCalls: ToolCallRef[];
}

export interface ToolResponseRequiredEvent {
  type: 'tool.response_required';
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
  type: 'thread.created';
  id: string;
  threadId: string;
  title: string;
  agentInfo: AgentInfo;
  parent: AgentParent;
  createdAt: string;
}

export interface ThreadDoneEvent {
  type: 'thread.done';
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
  type: 'mcp.auth_required';
  id: string;
  createdAt: string;
  threadId?: string | null;
  mcpServers: McpServerAuthInfo[];
}

export interface SandboxCreatedEvent {
  type: 'sandbox.created';
  id: string;
  createdAt: string;
  sandboxId: string;
  threadId: string | null;
}

export interface McpInitializeEvent {
  type: 'mcp.initialize';
  id: string;
  createdAt: string;
  threadId: string | null;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Turn lifecycle events
// ---------------------------------------------------------------------------

export interface TurnCreatedEvent {
  type: 'turn.created';
  id: string;
  turnId: string;
  previousTurnId?: string | null;
  input?: TurnInputItem[];
  state?: { status: 'running' };
  createdAt: string;
  threadId?: string | null;
}

export interface TurnDoneEvent {
  type: 'turn.done';
  id: string;
  state: Exclude<TurnState, { status: 'running' }>;
  createdAt: string;
  threadId?: string | null;
}

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
  | ToolResponseRequiredEvent;

/** Full streaming event union (includes deltas + turn lifecycle). */
export type TurnStreamingEvent = TurnEvent | ModelMessageDeltaEvent | TurnCreatedEvent | TurnDoneEvent;

export type ActionRequiredEvent = ToolApprovalRequiredEvent | ToolResponseRequiredEvent | McpAuthRequiredEvent;

export interface TurnStreamData<TStreamEvent extends TurnStreamingEvent = TurnStreamingEvent> {
  sequenceNumber: number;
  event: TStreamEvent;
}

/** Session-level event item from `listEvents`. */
export interface SessionEventItem {
  turnId: string;
  event: TurnCreatedEvent | TurnDoneEvent | TurnEvent;
}

export type DeltaEvents = ModelMessageDeltaEvent;
