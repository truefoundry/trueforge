'use client';

import { AssistantRuntimeProvider, useAuiState } from '@assistant-ui/react';
import {
  trueForgeAttachmentAdapter,
  useTrueForgeAgentRuntime,
  type TrueForgeAgentConfig,
  type UseTrueForgeAgentRuntimeOptions,
} from '@truefoundry/trueforge-assistant-ui-runtime';
import { useCallback, useMemo, type ReactNode } from 'react';

import { sessionIsCreateAgent } from '../atoms/lib/sessionCreateAgent.js';
import { notifyComposerBusyFailure } from '../hooks/useComposerBusyState.js';
import { ActiveSessionPermissionsProvider } from '../hooks/useResourcePermissions.js';
import type { AgentUIServer } from '../server/types.js';
import { ToasterProvider, useToaster } from './ToasterContainer.js';

type RuntimeAdapters = NonNullable<UseTrueForgeAgentRuntimeOptions['adapters']>;

function ActiveSessionPermissionScope({
  locallyCreatedSessionIds,
  children,
}: {
  locallyCreatedSessionIds: ReadonlySet<string>;
  children: ReactNode;
}) {
  const remoteId = useAuiState(state => state.threadListItem.remoteId);
  return (
    <ActiveSessionPermissionsProvider
      sessionId={remoteId}
      assumeManage={remoteId != null && locallyCreatedSessionIds.has(remoteId)}
    >
      {children}
    </ActiveSessionPermissionsProvider>
  );
}

function runtimeServer({
  server,
  locallyCreatedSessionIds,
}: {
  server: AgentUIServer;
  locallyCreatedSessionIds: Set<string>;
}): AgentUIServer {
  return {
    ...server,
    async createSession(request) {
      const session = await server.createSession(request);
      locallyCreatedSessionIds.add(session.id);
      return session;
    },
    async listSessions(request) {
      const result = await server.listSessions(request);
      return {
        ...result,
        data: result.data.filter(session => !sessionIsCreateAgent(session)),
      };
    },
  };
}

export type TrueForgeChatProviderProps = {
  server: AgentUIServer;
  initialSessionId?: string;
  adapters?: RuntimeAdapters;
  onError?: (error: unknown) => void;
  children: ReactNode;
  /** Discriminated agent source. Prefer over legacy `agentName`. */
  agent?: TrueForgeAgentConfig;
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
  agent?: TrueForgeAgentConfig;
  agentName?: string;
  listSessionsAgentId?: string;
  initialSessionId?: string;
  adapters?: RuntimeAdapters;
  onError?: (error: unknown) => void;
  children: ReactNode;
}) {
  const { showError } = useToaster();
  const reportError = onError ?? showError;
  const localSessionState = useMemo(() => ({ server, ids: new Set<string>() }), [server]);
  const locallyCreatedSessionIds = localSessionState.ids;
  const historyServer = useMemo(
    () => runtimeServer({ server, locallyCreatedSessionIds }),
    [locallyCreatedSessionIds, server],
  );
  // composer().send() is void and swallows onNew rejections; clear optimistic
  // busy when the runtime reports a pre-stream failure (e.g. createSession).
  const resolvedOnError = useCallback(
    (error: unknown) => {
      notifyComposerBusyFailure();
      reportError(error);
    },
    [reportError],
  );

  const runtime = useTrueForgeAgentRuntime({
    server: historyServer as never,
    agent,
    agentName,
    listSessionsAgentId,
    listSessionsCreatedByMe: true,
    initialSessionId,
    onError: resolvedOnError,
    adapters: {
      ...adapters,
      attachments: adapters?.attachments ?? trueForgeAttachmentAdapter,
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime as never}>
      <ActiveSessionPermissionScope locallyCreatedSessionIds={locallyCreatedSessionIds}>
        {children}
      </ActiveSessionPermissionScope>
    </AssistantRuntimeProvider>
  );
}

/**
 * Chat shell: wires `useTrueForgeAgentRuntime` from `server` and provides
 * assistant-ui + error toasts.
 */
export function TrueForgeChatProvider(props: TrueForgeChatProviderProps) {
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
