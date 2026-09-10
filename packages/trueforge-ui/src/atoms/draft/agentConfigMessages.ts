import type { TrueForgeApi } from '@truefoundry/trueforge-sdk';

import type { AgentSpec } from '../../server/types.js';

function isInitialUserMessage(value: unknown): value is TrueForgeApi.InitialUserMessage {
  if (typeof value !== 'object' || value === null) return false;
  return Reflect.get(value, 'type') === 'user.message' && typeof Reflect.get(value, 'content') === 'string';
}

// Adapts the SDK-owned messages field until the UI runtime contract exposes it
export function initialUserMessagesFromSpec(spec: AgentSpec): TrueForgeApi.InitialUserMessage[] {
  const value: unknown = Reflect.get(spec, 'messages');
  return Array.isArray(value) ? value.filter(isInitialUserMessage) : [];
}

export function withInitialUserMessages({
  spec,
  messages,
}: {
  spec: AgentSpec;
  messages: TrueForgeApi.InitialUserMessage[];
}): AgentSpec {
  const next = { ...spec, messages: messages.length > 0 ? messages : undefined };
  return next;
}
