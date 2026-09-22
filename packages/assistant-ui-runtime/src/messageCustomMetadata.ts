import type { McpAuthRequiredEvent } from './server/index.js';

import type { SubAgentCustomMetadata } from './foldPeerThreads.js';
import { TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY } from './toolApproval.js';
import { TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY } from './toolResponse.js';

/** Keys written to `ThreadMessage.metadata.custom` by this runtime adapter. */
export interface TrueForgeMessageCustomMetadata {
  subAgent?: SubAgentCustomMetadata;
  pendingMcpAuth?: true;
  mcpServers?: McpAuthRequiredEvent['mcpServers'];
  sandboxId?: string;
  /** Turn that produced this message. Scopes artifact downloads to their own turn. */
  turnId?: string;
  [TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY]?: string;
  [TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY]?: string;
}

export type SubAgentMessageCustomMetadata = Pick<TrueForgeMessageCustomMetadata, 'subAgent'>;

export type McpAuthMessageCustomMetadata = Pick<TrueForgeMessageCustomMetadata, 'pendingMcpAuth' | 'mcpServers'>;

export type SandboxMessageCustomMetadata = Pick<TrueForgeMessageCustomMetadata, 'sandboxId'>;

export type ToolApprovalMessageCustomMetadata = Pick<
  TrueForgeMessageCustomMetadata,
  typeof TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY
>;

export type ToolResponseMessageCustomMetadata = Pick<
  TrueForgeMessageCustomMetadata,
  typeof TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY
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
