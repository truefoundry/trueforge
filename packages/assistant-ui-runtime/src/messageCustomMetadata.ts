import type { McpAuthRequiredEvent } from './server/index.js';

import type { SubAgentCustomMetadata } from './foldPeerThreads.js';
import { TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY } from './toolApproval.js';
import { TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY } from './toolResponse.js';

/** Wire cancel reason from `turn.done` — UI reads this for the cancelled banner. */
export const CANCELLATION_REASON_CUSTOM_KEY = 'cancellationReason';

/** When the model requests several tools in one response, each toolCallId maps to that response's model.message id, so the UI can group them as parallel. */
export type ParallelToolGroups = Record<string, string>;

/** Keys written to `ThreadMessage.metadata.custom` by this runtime adapter. */
export interface TrueForgeMessageCustomMetadata {
  subAgent?: SubAgentCustomMetadata;
  pendingMcpAuth?: true;
  mcpServers?: McpAuthRequiredEvent['mcpServers'];
  sandboxId?: string;
  /** Turn that produced this message. Scopes artifact downloads to their own turn. */
  turnId?: string;
  /** When a tool call is replayed in a later model.message (e.g. after an approval), it keeps the first id so it stays in its original group. */
  parallelToolGroups?: ParallelToolGroups;
  [CANCELLATION_REASON_CUSTOM_KEY]?: string;
  [TOOL_APPROVAL_THREAD_ID_CUSTOM_KEY]?: string;
  [TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY]?: string;
}

/** When no tool calls were found, this returns `{}` so spreading it into metadata adds no empty key. */
export function parallelToolGroupsCustom(
  groups: ParallelToolGroups,
): Pick<TrueForgeMessageCustomMetadata, 'parallelToolGroups'> {
  return Object.keys(groups).length > 0 ? { parallelToolGroups: groups } : {};
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
