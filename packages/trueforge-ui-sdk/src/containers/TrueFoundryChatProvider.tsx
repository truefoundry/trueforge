'use client';

import { AssistantRuntimeProvider } from '@assistant-ui/react';
import {
  trueFoundryAttachmentAdapter,
  useTrueFoundryAgentRuntime,
  type TrueFoundryAgentConfig,
  type UseTrueFoundryAgentRuntimeOptions,
} from '@truefoundry/assistant-ui-runtime';
import { useCallback, useMemo, type ReactNode } from 'react';

import { notifyComposerBusyFailure } from '../hooks/useComposerBusyState.js';
import type { AgentUIServer } from '../server/types.js';
import { ToasterProvider, useToaster } from './ToasterContainer.js';

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
  /** Forwarded to `listSessions({ agentId })` for history filtering. */
  listSessionsAgentId?: string;
};

function ChatRuntimeScope({
  server,
  agent,
  agentName,
  listSessionsAgentId,
  initialSessionId,
  adapters,
  onError,
  children,
}: {
  server: AgentUIServer;
  agent?: TrueFoundryAgentConfig;
  agentName?: string;
  listSessionsAgentId?: string;
  initialSessionId?: string;
  adapters?: RuntimeAdapters;
  onError?: (error: unknown) => void;
  children: ReactNode;
}) {
  const { showError } = useToaster();
  const reportError = onError ?? showError;
  // composer().send() is void and swallows onNew rejections; clear optimistic
  // busy when the runtime reports a pre-stream failure (e.g. createSession).
  const resolvedOnError = useCallback(
    (error: unknown) => {
      notifyComposerBusyFailure();
      reportError(error);
    },
    [reportError],
  );

  const runtime = useTrueFoundryAgentRuntime({
    server: server as never,
    agent,
    agentName,
    listSessionsAgentId,
    initialSessionId,
    onError: resolvedOnError,
    adapters: {
      ...adapters,
      attachments: adapters?.attachments ?? trueFoundryAttachmentAdapter,
    },
  });

  return <AssistantRuntimeProvider runtime={runtime as never}>{children}</AssistantRuntimeProvider>;
}

/**
 * Chat shell: wires `useTrueFoundryAgentRuntime` from `server` and provides
 * assistant-ui + error toasts.
 */
export function TrueFoundryChatProvider(props: TrueFoundryChatProviderProps) {
  const { server, initialSessionId, adapters, onError, children, agent, agentName, listSessionsAgentId } = props;

  const stableServer = useMemo(() => server, [server]);

  return (
    <ToasterProvider>
      <ChatRuntimeScope
        server={stableServer}
        agent={agent}
        agentName={agentName}
        listSessionsAgentId={listSessionsAgentId}
        initialSessionId={initialSessionId}
        adapters={adapters}
        onError={onError}
      >
        {children}
      </ChatRuntimeScope>
    </ToasterProvider>
  );
}
