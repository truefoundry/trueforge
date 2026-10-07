'use client';

import { useAui, useAuiState } from '@assistant-ui/store';
import { useMemo } from 'react';

import { MESSAGE_CUSTOM_KEY } from './messageCustomMetadata.js';
import type { RespondToToolApprovalOptions } from './toolApproval.js';
import type { RespondToToolResponseOptions } from './toolResponse.js';
import {
  EMPTY_DRAFT_EXTRAS,
  getTrueForgeExtras,
  useTrueForgeRuntimeExtras,
  type TrueForgeDraftRuntimeExtras,
} from './trueforgeExtras.js';

/** Pending tool approvals plus a respond action. */
export const useTrueForgeApprovals = () => {
  const extras = useTrueForgeRuntimeExtras();

  return useMemo(
    () => ({
      pending: extras?.pendingApprovals ?? [],
      respond:
        extras?.respondToToolApproval ??
        (() => {
          throw new Error('TrueForge runtime is not ready yet');
        }),
    }),
    [extras],
  );
};

/** Pending ask-user tool responses plus a respond action. */
export const useTrueForgeToolResponses = () => {
  const extras = useTrueForgeRuntimeExtras();

  return useMemo(
    () => ({
      pending: extras?.pendingToolResponses ?? [],
      respond:
        extras?.respondToToolResponse ??
        (() => {
          throw new Error('TrueForge runtime is not ready yet');
        }),
    }),
    [extras],
  );
};

/** Pending MCP OAuth plus a continue action. */
export const useTrueForgeMcpAuth = () => {
  const extras = useTrueForgeRuntimeExtras();

  return useMemo(
    () => ({
      pending: extras?.pendingMcpAuth ?? null,
      continue: extras?.continueMcpAuth ?? (() => Promise.reject(new Error('TrueForge runtime is not ready yet'))),
    }),
    [extras],
  );
};

/** Returns a function to respond to a tool approval from any render context. */
export const useTrueForgeRespondToToolApproval = () => {
  const aui = useAui();
  return (response: RespondToToolApprovalOptions) => getTrueForgeExtras(aui).respondToToolApproval(response);
};

/** Returns a function to respond to a pending tool response from any render context. */
export const useTrueForgeRespondToToolResponse = () => {
  const aui = useAui();
  return (response: RespondToToolResponseOptions) => getTrueForgeExtras(aui).respondToToolResponse(response);
};

/** Returns a function to continue after MCP OAuth from any render context. */
export const useTrueForgeContinueMcpAuth = () => {
  const aui = useAui();
  return () => getTrueForgeExtras(aui).continueMcpAuth();
};

/** Current sandboxId for this session, if a sandbox has been created. */
export const useTrueForgeSandboxId = (): string | undefined => useTrueForgeRuntimeExtras()?.sandboxId;

/** Turn that produced the message being rendered. Only defined inside a message scope. */
export const useTrueForgeTurnId = (): string | undefined =>
  useAuiState(state => {
    const turnId = state.message.metadata.custom[MESSAGE_CUSTOM_KEY.TURN_ID];
    return typeof turnId === 'string' ? turnId : undefined;
  });

/**
 * Returns a function to download a file the current turn wrote to its sandbox. Must be called
 * from a message scope, since the artifact belongs to the turn that rendered it.
 * Does not require extras `sandboxId` — turn-scoped hosts resolve the sandbox from `turnId`.
 */
export const useTrueForgeDownloadSandboxFile = () => {
  const aui = useAui();
  const turnId = useTrueForgeTurnId();
  return (path: string) => {
    if (turnId == null) {
      throw new Error('Downloading a sandbox file requires a message scope to resolve its turn.');
    }
    return getTrueForgeExtras(aui).downloadSandboxFile({ turnId, path });
  };
};

/** Returns a function to cancel the current run from any render context. */
export const useTrueForgeCancel = () => {
  const aui = useAui();
  return () => getTrueForgeExtras(aui).cancel();
};

/** Returns a function to reload (retry) the current session from any render context. */
export const useTrueForgeReload = () => {
  const aui = useAui();
  return () => {
    getTrueForgeExtras(aui).reload();
  };
};

/** Older history pagination state plus a load-more action for scroll-up. */
export const useTrueForgeHistoryPagination = () => {
  const extras = useTrueForgeRuntimeExtras();

  return useMemo(
    () => ({
      hasOlderHistory: extras?.hasOlderHistory ?? false,
      isLoadingOlderHistory: extras?.isLoadingOlderHistory ?? false,
      loadOlderHistory:
        extras?.loadOlderHistory ?? (() => Promise.reject(new Error('TrueForge runtime is not ready yet'))),
    }),
    [extras],
  );
};

/** Returns a function to reset (re-submit) a user turn from any render context. */
export const useTrueForgeResetFromTurn = () => {
  const aui = useAui();
  return (turnId: string) => getTrueForgeExtras(aui).resetFromTurn(turnId);
};

/** Current draft agent spec and sync state (draft mode only). */
export const useTrueForgeAgentSpec = () => {
  const extras = useTrueForgeRuntimeExtras()?.draft ?? null;

  return useMemo(() => ({ ...EMPTY_DRAFT_EXTRAS, ...extras }), [extras]);
};

/** Returns a draft spec updater from any render context. */
export const useTrueForgeUpdateAgentSpec = () => {
  const aui = useAui();
  return (update: Parameters<TrueForgeDraftRuntimeExtras['updateAgentSpec']>[0]) =>
    getTrueForgeExtras(aui).draft?.updateAgentSpec(update);
};

/** Flushes any pending draft-spec synchronization before a coordinated write. */
export const useTrueForgeFlushAgentSpec = () => {
  const aui = useAui();
  return () => getTrueForgeExtras(aui).draft?.flushAgentSpec() ?? Promise.resolve();
};

/** Adopts a spec already persisted by another server operation without syncing again. */
export const useTrueForgeAdoptAgentSpec = () => {
  const aui = useAui();
  return (request: Parameters<TrueForgeDraftRuntimeExtras['adoptAgentSpec']>[0]) =>
    getTrueForgeExtras(aui).draft?.adoptAgentSpec(request);
};
