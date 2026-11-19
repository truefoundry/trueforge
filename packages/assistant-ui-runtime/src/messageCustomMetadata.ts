import type { McpAuthRequiredEvent } from './server/index.js';

import type { SubAgentCustomMetadata } from './foldPeerThreads.js';

export const MESSAGE_CUSTOM_KEY = {
  MCP_SERVERS: 'mcpServers',
  PARALLEL_TOOL_GROUPS: 'parallelToolGroups',
  PENDING_MCP_AUTH: 'pendingMcpAuth',
  SANDBOX_ID: 'sandboxId',
  SUB_AGENT: 'subAgent',
  TOOL_APPROVAL_THREAD_ID: 'toolApprovalThreadId',
  TOOL_RESPONSE_THREAD_ID: 'toolResponseThreadId',
  TURN_ID: 'turnId',
} as const;

/** Wire cancel reason from `turn.done` — UI reads this for the cancelled banner. */
export const CANCELLATION_REASON_CUSTOM_KEY = 'cancellationReason';

/** When the model requests several tools in one response, each toolCallId maps to that response's model.message id, so the UI can group them as parallel. */
export type ParallelToolGroups = Record<string, string>;

/** Keys written to `ThreadMessage.metadata.custom` by this runtime adapter. */
export interface TrueForgeMessageCustomMetadata {
  [MESSAGE_CUSTOM_KEY.SUB_AGENT]?: SubAgentCustomMetadata;
  [MESSAGE_CUSTOM_KEY.PENDING_MCP_AUTH]?: true;
  [MESSAGE_CUSTOM_KEY.MCP_SERVERS]?: McpAuthRequiredEvent['mcpServers'];
  [MESSAGE_CUSTOM_KEY.SANDBOX_ID]?: string;
  /** Turn that produced this message. Scopes artifact downloads to their own turn. */
  [MESSAGE_CUSTOM_KEY.TURN_ID]?: string;
  /** When a tool call is replayed in a later model.message (e.g. after an approval), it keeps the first id so it stays in its original group. */
  [MESSAGE_CUSTOM_KEY.PARALLEL_TOOL_GROUPS]?: ParallelToolGroups;
  [CANCELLATION_REASON_CUSTOM_KEY]?: string;
  [MESSAGE_CUSTOM_KEY.TOOL_APPROVAL_THREAD_ID]?: string;
  [MESSAGE_CUSTOM_KEY.TOOL_RESPONSE_THREAD_ID]?: string;
}

/** When no tool calls were found, this returns `{}` so spreading it into metadata adds no empty key. */
export function parallelToolGroupsCustom(
  groups: ParallelToolGroups,
): Pick<TrueForgeMessageCustomMetadata, typeof MESSAGE_CUSTOM_KEY.PARALLEL_TOOL_GROUPS> {
  return Object.keys(groups).length > 0 ? { [MESSAGE_CUSTOM_KEY.PARALLEL_TOOL_GROUPS]: groups } : {};
}

export type SubAgentMessageCustomMetadata = Pick<TrueForgeMessageCustomMetadata, typeof MESSAGE_CUSTOM_KEY.SUB_AGENT>;

export type McpAuthMessageCustomMetadata = Pick<
  TrueForgeMessageCustomMetadata,
  typeof MESSAGE_CUSTOM_KEY.PENDING_MCP_AUTH | typeof MESSAGE_CUSTOM_KEY.MCP_SERVERS
>;

export type SandboxMessageCustomMetadata = Pick<TrueForgeMessageCustomMetadata, typeof MESSAGE_CUSTOM_KEY.SANDBOX_ID>;

export type ToolApprovalMessageCustomMetadata = Pick<
  TrueForgeMessageCustomMetadata,
  typeof MESSAGE_CUSTOM_KEY.TOOL_APPROVAL_THREAD_ID
>;

export type ToolResponseMessageCustomMetadata = Pick<
  TrueForgeMessageCustomMetadata,
  typeof MESSAGE_CUSTOM_KEY.TOOL_RESPONSE_THREAD_ID
>;

export function isUnknownRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

export function isMcpServerAuthInfoList(value: unknown): value is McpAuthRequiredEvent['mcpServers'] {
  return (
    Array.isArray(value) &&
    value.every(
      server =>
        isUnknownRecord(server) &&
        typeof server['id'] === 'string' &&
        typeof server['name'] === 'string' &&
        typeof server['authUrl'] === 'string',
    )
  );
}
