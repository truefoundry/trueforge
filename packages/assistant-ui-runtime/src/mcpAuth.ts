import type { MessageStatus } from '@assistant-ui/core';
import type { McpAuthRequiredEvent, TurnStateDone } from './server/index.js';
import { EVENT_TYPE } from './server/index.js';

import { interruptRequiredAssistantStatus } from './assistantMessageStatus.js';
import { MESSAGE_CUSTOM_KEY, type McpAuthMessageCustomMetadata } from './messageCustomMetadata.js';
import type { AssistantContentPart } from './modelMessageContent.js';

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
  // Kept for history written before paused turns became non-terminal.
  const found = requiredActions?.find(action => action.type === EVENT_TYPE.MCP_AUTH_REQUIRED);
  return found?.type === EVENT_TYPE.MCP_AUTH_REQUIRED ? found : undefined;
}

export function mcpAuthAssistantStatus(): MessageStatus {
  return interruptRequiredAssistantStatus();
}

export function mcpAuthMessageCustom(servers: readonly McpServerAuthInfo[]): McpAuthMessageCustomMetadata {
  return {
    [MESSAGE_CUSTOM_KEY.PENDING_MCP_AUTH]: true,
    [MESSAGE_CUSTOM_KEY.MCP_SERVERS]: [...servers],
  };
}
