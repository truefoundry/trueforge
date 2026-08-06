'use client';

import { AssistantRuntimeProvider } from '@assistant-ui/react';
import {
  trueFoundryAttachmentAdapter,
  useTrueFoundryAgentRuntime,
  type TrueFoundryAgentConfig,
  type UseTrueFoundryAgentRuntimeOptions,
} from '@truefoundry/assistant-ui-runtime';
import { useMemo, type ReactNode } from 'react';

import type { AgentUIServer } from '../server/types.js';
import { ErrorToasterProvider, useErrorToaster } from './ErrorToasterContainer.js';

type RuntimeAdapters = NonNullable<UseTrueFoundryAgentRuntimeOptions['adapters']>;

export type TrueFoundryChatProviderProps = {
  server: AgentUIServer;
  initialSessionId?: string;
  adapters?: RuntimeAdapters;
  onError?: (error: unknown) => void;
  children: ReactNode;
  /** Discriminated agent source. Prefer over legacy `agentName`. */
  agent?: TrueFoundryAgentConfig;
  /** Legacy named-agent shorthand. Prefer `agent: { mode: "named", agentName }`. */
  agentName?: string;
};

function ChatRuntimeScope({
  server,
  agent,
  agentName,
  initialSessionId,
  adapters,
  onError,
  children,
}: {
  server: AgentUIServer;
  agent?: TrueFoundryAgentConfig;
  agentName?: string;
  initialSessionId?: string;
  adapters?: RuntimeAdapters;
  onError?: (error: unknown) => void;
  children: ReactNode;
}) {
  const { showError } = useErrorToaster();
  const resolvedOnError = onError ?? showError;

  const runtime = useTrueFoundryAgentRuntime({
    server: server as never,
    agent,
    agentName,
    initialSessionId,
    onError: resolvedOnError,
    adapters: {
      ...adapters,
      attachments: adapters?.attachments ?? trueFoundryAttachmentAdapter,
    },
  });

  return <AssistantRuntimeProvider runtime={runtime}>{children}</AssistantRuntimeProvider>;
}

/**
 * Chat shell: wires `useTrueFoundryAgentRuntime` from `server` and provides
 * assistant-ui + error toasts.
 */
export function TrueFoundryChatProvider(props: TrueFoundryChatProviderProps) {
  const { server, initialSessionId, adapters, onError, children, agent, agentName } = props;

  const stableServer = useMemo(() => server, [server]);

  return (
    <ErrorToasterProvider>
      <ChatRuntimeScope
        server={stableServer}
        agent={agent}
        agentName={agentName}
        initialSessionId={initialSessionId}
        adapters={adapters}
        onError={onError}
      >
        {children}
      </ChatRuntimeScope>
    </ErrorToasterProvider>
  );
}
