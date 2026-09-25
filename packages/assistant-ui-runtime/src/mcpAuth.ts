import type { MessageStatus } from '@assistant-ui/core';
import type { McpAuthRequiredEvent, TurnStateDone } from './server/index.js';

import type { McpAuthMessageCustomMetadata } from './messageCustomMetadata.js';
import type { AssistantContentPart } from './modelMessageContent.js';

/** `runConfig.custom` flag: resume after MCP OAuth with an empty SDK turn input. */
export const MCP_AUTH_RESUME_RUN_CUSTOM_KEY = 'resumeMcpAuth';

type McpServerAuthInfo = McpAuthRequiredEvent['mcpServers'][number];

export function buildMcpAuthTextParts(servers?: readonly McpServerAuthInfo[]): AssistantContentPart[] {
  void servers;
  const text = [
    'This agent needs access to external services before it can continue.',
    '',
    'Click the **Connect** button(s) to authorize the Connectors, then press **Continue**.',
  ].join('\n');
  return [{ type: 'text', text }];
}

export function findMcpAuthRequired(
  requiredActions: TurnStateDone['requiredActions'] | undefined,
): McpAuthRequiredEvent | undefined {
  const found = requiredActions?.find(action => action.type === 'mcp.auth_required');
  return found?.type === 'mcp.auth_required' ? found : undefined;
}

export function mcpAuthAssistantStatus(): MessageStatus {
  return { type: 'requires-action', reason: 'interrupt' };
}

export function mcpAuthMessageCustom(servers: readonly McpServerAuthInfo[]): McpAuthMessageCustomMetadata {
  return { pendingMcpAuth: true, mcpServers: [...servers] };
}
