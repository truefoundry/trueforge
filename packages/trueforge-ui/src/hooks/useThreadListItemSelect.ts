'use client';

import { useAui, useAuiState } from '@assistant-ui/react';
import type { RefObject } from 'react';

import { useTrackAnalytics } from '../analytics/AnalyticsProvider.js';
import { AnalyticsEvents } from '../analytics/events.js';
import { withSessionProps } from '../analytics/sessionProps.js';
import { sessionIsCreateAgent } from '../atoms/lib/sessionCreateAgent.js';
import {
  canReuseMutableShell,
  readThreadAgentName,
  readThreadIsCreateAgent,
  readThreadIsMutable,
  threadListItemIsMutable,
} from '../atoms/lib/threadListMeta.js';
import { useOptionalServer } from '../server/ServerContext.js';
import { shellIsCreateAgent, useOptionalShellMode } from '../server/ShellModeContext.js';

/**
 * Open a chat-history row from the search popup.
 * When mutability is unknown on a saved session, we ask the server first so a saved-agent
 * chat is not reopened as a draft.
 *
 * `runtimeKeyRef` must live on a parent that stays mounted for the whole select (the search
 * button), so an in-flight getSession can still see New Chat / agent remounts after the
 * result row unmounts.
 */
export function useThreadListItemSelect({
  selectionRef,
  runtimeKeyRef,
  onThreadOpen,
}: {
  selectionRef: RefObject<number>;
  runtimeKeyRef: RefObject<string | undefined>;
  onThreadOpen?: () => void;
}): {
  displayTitle: string;
  select: () => Promise<void>;
} {
  const aui = useAui();
  const shell = useOptionalShellMode();
  const server = useOptionalServer();
  const track = useTrackAnalytics();

  const id = useAuiState(s => s.threadListItem.id);
  const remoteId = useAuiState(s => s.threadListItem.remoteId);
  const title = useAuiState(s => s.threadListItem.title);
  const custom = useAuiState(s => s.threadListItem.custom);
  const agentName = readThreadAgentName(custom);
  const displayTitle = title ?? 'New Chat';

  const openRow = ({
    sessionMutable,
    rowAgentName,
    rowIsCreateAgent,
  }: {
    sessionMutable: boolean;
    rowAgentName: string | undefined;
    rowIsCreateAgent: boolean;
  }) => {
    const sameImmutable =
      !sessionMutable &&
      shell?.mode.status === 'active' &&
      !shell.mode.isMutable &&
      (rowAgentName == null
        ? shell.mode.agentName == null && shell.mode.agentId == null
        : shell.mode.agentName === rowAgentName || shell.mode.agentId === rowAgentName);
    const sameMutable = canReuseMutableShell({
      sessionMutable,
      shellMutable: shell?.mode.status === 'active' && shell.mode.isMutable,
      sessionIsCreateAgent: rowIsCreateAgent,
      shellIsCreateAgent: shell?.mode != null && shellIsCreateAgent(shell.mode),
      ...(shell?.mode.status === 'active' && shell.mode.isMutable
        ? { shellAgentName: shell.mode.agentName, shellAgentId: shell.mode.agentId }
        : {}),
      remoteId,
      pendingSessionId: shell?.pendingSessionId,
    });

    // An access-error pane must go through openHistorySession so the error clears.
    if ((sameImmutable || sameMutable) && remoteId != null && shell?.sessionAccessError == null) {
      void Promise.resolve(aui.threads().switchToThread(id)).catch(() => undefined);
      return;
    }
    if (remoteId != null) {
      shell?.openHistorySession({
        sessionId: remoteId,
        isMutable: sessionMutable,
        isCreateAgent: rowIsCreateAgent,
        ...(rowAgentName != null ? { agentName: rowAgentName } : {}),
      });
      return;
    }
    void Promise.resolve(aui.threads().switchToThread(id)).catch(() => undefined);
  };

  const select = (): Promise<void> => {
    track(
      AnalyticsEvents.Session.SELECTED,
      withSessionProps({ is_mutable: threadListItemIsMutable(custom) }, { sessionId: remoteId, agentName }),
    );
    const selection = ++selectionRef.current;
    const clickedRuntimeKey = runtimeKeyRef.current;
    onThreadOpen?.();
    shell?.setSettingsOpen(false);
    shell?.setLibraryOpen(false);
    shell?.setSessionsOpen(false);
    shell?.setSchedulesOpen(false);
    shell?.setEnvironmentsOpen(false);

    const stillCurrent = () => selectionRef.current === selection && runtimeKeyRef.current === clickedRuntimeKey;

    // A row created in this client has no custom yet; defaulting to mutable would
    // reopen a saved-agent chat as a draft, so ask the server first.
    if (remoteId != null && server != null && readThreadIsMutable(custom) === undefined && agentName == null) {
      return server
        .getSession({ sessionId: remoteId })
        .then(
          session => ({
            sessionMutable: session.isMutable,
            rowAgentName: session.agentName ?? undefined,
            rowIsCreateAgent: sessionIsCreateAgent(session),
          }),
          () => ({
            sessionMutable: threadListItemIsMutable(custom),
            rowAgentName: agentName,
            rowIsCreateAgent: readThreadIsCreateAgent(custom),
          }),
        )
        .then(resolved => {
          // A later pick / dialog close / New Chat remount supersedes this open.
          if (stillCurrent()) openRow(resolved);
        });
    }
    // Prefer custom.isMutable (session wire); agentName-only is a legacy fallback.
    if (stillCurrent()) {
      openRow({
        sessionMutable: threadListItemIsMutable(custom),
        rowAgentName: agentName,
        rowIsCreateAgent: readThreadIsCreateAgent(custom),
      });
    }
    return Promise.resolve();
  };

  return { displayTitle, select };
}
