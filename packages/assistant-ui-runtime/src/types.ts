import type {
  AttachmentAdapter,
  DictationAdapter,
  ExternalStoreSharedOptions,
  FeedbackAdapter,
  RealtimeVoiceAdapter,
  SpeechSynthesisAdapter,
} from '@assistant-ui/core';

import type { AgentChatServer, AgentSpec } from './server/types.js';

export interface NamedAgentConfig {
  mode: 'named';
  agentName: string;
}

export interface DraftAgentConfig {
  mode: 'draft';
  defaultAgentSpec: AgentSpec;
  onAgentSpecChange?: ((spec: AgentSpec) => void) | undefined;
}

export type TrueForgeAgentConfig = NamedAgentConfig | DraftAgentConfig;

type TrueForgeAgentRuntimeBaseOptions = ExternalStoreSharedOptions & {
  server: AgentChatServer;
  initialSessionId?: string | undefined;
  threadId?: string | undefined;
  onThreadIdChange?: ((threadId: string | undefined) => void) | undefined;
  onError?: ((error: unknown) => void) | undefined;
  /**
   * Optional filter forwarded to `listSessions({ agentId })`.
   * Omit for all chats; hosts that key agents by name pass that name as the id.
   */
  listSessionsAgentId?: string | undefined;
  /** Restrict thread history to sessions created by the authenticated subject. */
  listSessionsCreatedByMe?: boolean | undefined;
  adapters?:
    | {
        attachments?: AttachmentAdapter | undefined;
        speech?: SpeechSynthesisAdapter | undefined;
        dictation?: DictationAdapter | undefined;
        voice?: RealtimeVoiceAdapter | undefined;
        feedback?: FeedbackAdapter | undefined;
      }
    | undefined;
};

export type UseTrueForgeAgentRuntimeOptions = TrueForgeAgentRuntimeBaseOptions & {
  /** Discriminated agent source. Omit when using legacy `agentName`. */
  agent?: TrueForgeAgentConfig | undefined;
  /** Legacy named-agent shorthand. Prefer `agent: { mode: "named", agentName }`. */
  agentName?: string | undefined;
};

export type ResolvedTrueForgeAgentRuntimeOptions = TrueForgeAgentRuntimeBaseOptions & {
  agent: TrueForgeAgentConfig;
};

export function resolveTrueForgeAgentConfig(
  options: Pick<UseTrueForgeAgentRuntimeOptions, 'agent' | 'agentName'>,
): TrueForgeAgentConfig {
  if (options.agent != null) {
    if (options.agent.mode === 'named' && options.agentName != null) {
      return { mode: 'named', agentName: options.agentName };
    }
    return options.agent;
  }
  if (options.agentName != null) {
    return { mode: 'named', agentName: options.agentName };
  }
  throw new Error('useTrueForgeAgentRuntime requires `agent` or legacy `agentName`.');
}

export function resolveTrueForgeAgentRuntimeOptions(
  options: UseTrueForgeAgentRuntimeOptions,
): ResolvedTrueForgeAgentRuntimeOptions {
  const agent = resolveTrueForgeAgentConfig(options);

  return {
    ...options,
    agent,
  };
}
