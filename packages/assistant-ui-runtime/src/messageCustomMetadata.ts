import type { McpAuthRequiredEvent } from './server/index.js';

import type { SubAgentCustomMetadata } from './foldPeerThreads.js';

export const MESSAGE_CUSTOM_KEY = {
  MCP_SERVERS: 'mcpServers',
  PENDING_MCP_AUTH: 'pendingMcpAuth',
  SANDBOX_ID: 'sandboxId',
  SUB_AGENT: 'subAgent',
  TOOL_APPROVAL_THREAD_ID: 'toolApprovalThreadId',
  TOOL_RESPONSE_THREAD_ID: 'toolResponseThreadId',
  TURN_ID: 'turnId',
} as const;

/** Keys written to `ThreadMessage.metadata.custom` by this runtime adapter. */
export interface TrueForgeMessageCustomMetadata {
  [MESSAGE_CUSTOM_KEY.SUB_AGENT]?: SubAgentCustomMetadata;
  [MESSAGE_CUSTOM_KEY.PENDING_MCP_AUTH]?: true;
  [MESSAGE_CUSTOM_KEY.MCP_SERVERS]?: McpAuthRequiredEvent['mcpServers'];
  [MESSAGE_CUSTOM_KEY.SANDBOX_ID]?: string;
  /** Turn that produced this message. Scopes artifact downloads to their own turn. */
  [MESSAGE_CUSTOM_KEY.TURN_ID]?: string;
  [MESSAGE_CUSTOM_KEY.TOOL_APPROVAL_THREAD_ID]?: string;
  [MESSAGE_CUSTOM_KEY.TOOL_RESPONSE_THREAD_ID]?: string;
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
