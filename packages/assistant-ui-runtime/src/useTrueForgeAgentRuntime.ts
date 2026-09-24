'use client';

import {
  pickExternalStoreSharedOptions,
  type AppendMessage,
  type RemoteThreadListAdapter,
  type ToolExecutionStatus,
} from '@assistant-ui/core';
import { useExternalStoreRuntime, useRemoteThreadListRuntime, useRuntimeAdapters } from '@assistant-ui/core/react';
import { useAui, useAuiState } from '@assistant-ui/store';
import type { RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  collectPendingApprovals,
  collectPendingToolResponses,
  derivePendingMcpAuth,
  deriveSandboxId,
} from './collectPending.js';
import {
  buildUserMessageContent,
  extractEditedText,
  parseTurnIdFromMessageId,
  userMessageContentToText,
} from './convertTurnMessages.js';
import { createDraftSessionBridge, DRAFT_SESSION_LAST_UPDATED_AT_HEADER } from './draft/draftSessionBridge.js';
import { createTrueForgeDraftThreadListAdapter } from './draft/trueforgeDraftThreadListAdapter.js';
import { useDraftAgentSpec } from './draft/useDraftAgentSpec.js';
import { buildSandboxDownloadRequest } from './sandboxDownload.js';
import type { AgentSpec } from './server/types.js';
import { trueForgeExtras } from './trueforgeExtras.js';
import { createTrueForgeThreadListAdapter } from './trueforgeThreadListAdapter.js';
import type { UseTrueForgeAgentRuntimeOptions } from './types.js';
import { resolveTrueForgeAgentRuntimeOptions } from './types.js';
import { useTrueForgeAgentMessages } from './useTrueForgeAgentMessages.js';

/**
 * Wraps the mode-specific adapter behind a stable object so assistant-ui does
 * not treat a draft/named mode switch as an adapter change (which would reset
 * loaded thread-list pages). Each call reads the ref, so behavior always
 * follows the current mode.
 */
function createDelegatingThreadListAdapter(adapterRef: RefObject<RemoteThreadListAdapter>): RemoteThreadListAdapter {
  return {
    list: params => adapterRef.current.list(params),
    initialize: threadId => adapterRef.current.initialize(threadId),
    fetch: threadId => adapterRef.current.fetch(threadId),
    rename: (remoteId, newTitle) => adapterRef.current.rename(remoteId, newTitle),
    archive: remoteId => adapterRef.current.archive(remoteId),
    unarchive: remoteId => adapterRef.current.unarchive(remoteId),
    delete: remoteId => adapterRef.current.delete(remoteId),
    generateTitle: (remoteId, messages) => adapterRef.current.generateTitle(remoteId, messages),
  };
}

function useTrueForgeAgentRuntimeImpl(
  options: ReturnType<typeof resolveTrueForgeAgentRuntimeOptions>,
  pendingAgentSpecRef: RefObject<AgentSpec | undefined>,
) {
  const { server, agent, adapters, onError, ...sharedOptions } = options;

  const draftBridgeRef = useRef(agent.mode === 'draft' ? createDraftSessionBridge(server) : null);

  const draftSessionId = useAuiState(state =>
    agent.mode === 'draft' ? (state.threadListItem.remoteId ?? undefined) : undefined,
  );
  const sessionId = useAuiState(state => state.threadListItem.remoteId ?? undefined);
  const isMain = useAuiState(state => state.threads.mainThreadId === state.threadListItem.id);
  // On a hard refresh, the URL session runtime mounts before assistant-ui
  // promotes it to the main thread. Allow that one session to hydrate early.
  const isInitialSession = sessionId != null && sessionId === options.initialSessionId;

  const draftSpec = useDraftAgentSpec({
    draftSessionId,
    draftBridge: draftBridgeRef.current,
    defaultAgentSpec: agent.mode === 'draft' ? agent.defaultAgentSpec : { model: { name: '' } },
    onAgentSpecChange: agent.mode === 'draft' ? agent.onAgentSpecChange : undefined,
    onError,
  });

  const takeTurnHeaderTimestampRef = useRef(draftSpec.takeTurnHeaderTimestamp);
  takeTurnHeaderTimestampRef.current = draftSpec.takeTurnHeaderTimestamp;

  const getTurnHeaders = useCallback(async () => {
    if (agent.mode !== 'draft') {
      return undefined;
    }
    const updatedAt = await takeTurnHeaderTimestampRef.current();
    if (updatedAt == null) {
      return undefined;
    }
    return { [DRAFT_SESSION_LAST_UPDATED_AT_HEADER]: updatedAt };
  }, [agent.mode]);

  const aui = useAui();
  const initializeSession = useCallback(() => aui.threadListItem().initialize(), [aui]);
  const runtimeAdapters = useRuntimeAdapters();
  const [, setToolStatuses] = useState<Record<string, ToolExecutionStatus>>({});

  const {
    messages,
    isRunning,
    isLoading,
    isLoadingOlderHistory,
    hasOlderHistory,
    loadOlderHistory,
    sendTurn,
    cancel,
    respondToToolApproval,
    respondToToolResponse,
    continueMcpAuth,
    resumeRun,
    editFromTurn,
    resetFromTurn,
    resolveSandboxIdForTurn,
    retryLoad,
  } = useTrueForgeAgentMessages({
    server,
    sessionId,
    isMain,
    isInitialSession,
    onError,
    initializeSession,
    ...(agent.mode === 'draft' ? { getTurnHeaders } : {}),
  });

  if (agent.mode === 'draft' && draftSpec.agentSpec != null) {
    pendingAgentSpecRef.current = draftSpec.agentSpec;
  }

  const pendingApprovals = useMemo(() => collectPendingApprovals(messages), [messages]);
  const pendingToolResponses = useMemo(() => collectPendingToolResponses(messages), [messages]);
  const pendingMcpAuth = useMemo(() => derivePendingMcpAuth(messages), [messages]);
  const sandboxId = useMemo(() => deriveSandboxId(messages), [messages]);

  const downloadSandboxFile = useCallback(
    async ({ turnId, path }: { turnId: string; path: string }) => {
      if (server.downloadSandboxFile == null) {
        throw new Error('Downloading a sandbox file requires AgentChatServer.downloadSandboxFile.');
      }
      // Prefer the sandbox that was current as of this turn (paging in
      // older history if its reference predates the loaded window); the
      // session-wide latest covers turns projected without a record.
      // sandboxId stays best-effort — turn-scoped hosts resolve the
      // sandbox from turnId and need no sandboxId at all.
      const turnSandboxId = (await resolveSandboxIdForTurn(turnId)) ?? sandboxId;
      return await server.downloadSandboxFile(
        buildSandboxDownloadRequest({
          sessionId,
          turnId,
          path,
          ...(turnSandboxId != null ? { sandboxId: turnSandboxId } : {}),
        }),
      );
    },
    [server, sessionId, sandboxId, resolveSandboxIdForTurn],
  );

  const draftExtras = useMemo(() => {
    if (agent.mode !== 'draft') {
      return null;
    }
    return {
      agentSpec: draftSpec.agentSpec,
      draftSessionId: draftSpec.draftSessionId,
      isSpecLoading: draftSpec.isSpecLoading,
      isSpecSyncing: draftSpec.isSpecSyncing,
      specError: draftSpec.specError,
      updateAgentSpec: draftSpec.updateAgentSpec,
      flushAgentSpec: draftSpec.flushAgentSpec,
      adoptAgentSpec: draftSpec.adoptAgentSpec,
    };
  }, [agent.mode, draftSpec]);

  return useExternalStoreRuntime({
    ...pickExternalStoreSharedOptions(sharedOptions),
    messages,
    isRunning,
    isLoading,
    extras: trueForgeExtras.provide({
      pendingApprovals,
      pendingToolResponses,
      pendingMcpAuth,
      sandboxId,
      respondToToolApproval,
      respondToToolResponse,
      continueMcpAuth,
      downloadSandboxFile,
      cancel,
      // resetFromTurn/branchFromTurn/sendTurn already report via onError.
      resetFromTurn: (turnId: string) => resetFromTurn(turnId).catch(() => undefined),
      reload: retryLoad,
      hasOlderHistory,
      isLoadingOlderHistory,
      loadOlderHistory,
      draft: draftExtras,
    }),
    unstable_enableToolInvocations: true,
    setToolStatuses,
    adapters: {
      attachments: adapters?.attachments ?? runtimeAdapters?.attachments,
      speech: adapters?.speech,
      dictation: adapters?.dictation,
      voice: adapters?.voice,
      feedback: adapters?.feedback,
    },
    onNew: async (message: AppendMessage) => {
      if (!(message.startRun ?? message.role === 'user')) {
        return;
      }

      const userMessage = buildUserMessageContent(message);
      await sendTurn({
        userMessage,
        // The composer clears before onNew runs. Restore its text only when
        // the turn failed before turn.created registered it in the backend.
        onPreTurnFailure: () => {
          const text = userMessageContentToText(userMessage);
          const composer = aui.thread().composer();
          if (text && !composer.getState().text.trim()) {
            composer.setText(text);
          }
        },
      });
    },
    onCancel: async () => {
      await cancel();
    },
    onRespondToToolApproval: respondToToolApproval,
    onResume: async () => {
      await resumeRun();
    },
    onEdit: async (message: AppendMessage) => {
      const sourceId = message.sourceId;
      if (sourceId == null) {
        throw new Error('Could not resolve edited user message.');
      }
      const turnId = parseTurnIdFromMessageId(sourceId);
      const editedText = extractEditedText(message);
      // editFromTurn/branchFromTurn/sendTurn already report via onError.
      await editFromTurn(turnId, editedText);
    },
  });
}

export function useTrueForgeAgentRuntime(options: UseTrueForgeAgentRuntimeOptions) {
  const resolved = resolveTrueForgeAgentRuntimeOptions(options);
  const { server, agent } = resolved;

  const pendingAgentSpecRef = useRef<AgentSpec | undefined>(
    agent.mode === 'draft' ? agent.defaultAgentSpec : undefined,
  );

  const listSessionsAgentId = resolved.listSessionsAgentId;
  const listSessionsCreatedByMe = resolved.listSessionsCreatedByMe;
  // Mode-specific adapter: rebuilt on draft/named switches, but never handed
  // to assistant-ui directly — it is reached through the delegating adapter below.
  const modeThreadListAdapter = useMemo(() => {
    if (agent.mode === 'draft') {
      return createTrueForgeDraftThreadListAdapter({
        server,
        defaultAgentSpec: agent.defaultAgentSpec,
        getAgentSpec: () => pendingAgentSpecRef.current ?? agent.defaultAgentSpec,
        ...(listSessionsAgentId == null ? {} : { listSessionsAgentId }),
        ...(listSessionsCreatedByMe == null ? {} : { listSessionsCreatedByMe }),
      });
    }
    return createTrueForgeThreadListAdapter({
      server,
      agentName: agent.agentName,
      ...(listSessionsAgentId == null ? {} : { listSessionsAgentId }),
      ...(listSessionsCreatedByMe == null ? {} : { listSessionsCreatedByMe }),
    });
  }, [agent, listSessionsAgentId, listSessionsCreatedByMe, server]);
  const modeThreadListAdapterRef = useRef(modeThreadListAdapter);
  useEffect(() => {
    modeThreadListAdapterRef.current = modeThreadListAdapter;
  }, [modeThreadListAdapter]);
  // Identity stays stable across mode switches; a new server or session
  // filter is a genuinely different list, so those do reset it.
  const threadListAdapter = useMemo(
    () => createDelegatingThreadListAdapter(modeThreadListAdapterRef),
    [listSessionsAgentId, listSessionsCreatedByMe, server],
  );

  return useRemoteThreadListRuntime({
    allowNesting: true,
    adapter: threadListAdapter,
    initialThreadId: resolved.initialSessionId,
    threadId: resolved.threadId,
    onThreadIdChange: resolved.onThreadIdChange,
    runtimeHook: () => useTrueForgeAgentRuntimeImpl(resolved, pendingAgentSpecRef),
  });
}
