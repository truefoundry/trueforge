import type { MessageStatus } from '@assistant-ui/core';
import type { McpAuthRequiredEvent, TurnStateDone } from './server/index.js';
import { EVENT_TYPE, TURN_STATUS } from './server/index.js';

import { interruptRequiredAssistantStatus, runningAssistantStatus } from './assistantMessageStatus.js';
import {
  isMcpServerAuthInfoList,
  MESSAGE_CUSTOM_KEY,
  type McpAuthMessageCustomMetadata,
} from './messageCustomMetadata.js';
import type { AssistantContentPart } from './modelMessageContent.js';
import { replaceSessionSnapshot, STREAM_SEGMENT_STATUS, type SessionSnapshot } from './sessionSnapshot.js';

type McpServerAuthInfo = McpAuthRequiredEvent['mcpServers'][number];

const MCP_AUTH_HINT_TEXT = [
  'This agent needs access to external services before it can continue.',
  '',
  'Click the **Connect** button(s) to authorize the Connectors, then press **Continue**.',
].join('\n');

export function buildMcpAuthTextParts(servers?: readonly McpServerAuthInfo[]): AssistantContentPart[] {
  void servers;
  return [{ type: 'text', text: MCP_AUTH_HINT_TEXT }];
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

function omitMcpAuthMessageCustom(custom: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(custom).filter(
      ([key]) => key !== MESSAGE_CUSTOM_KEY.PENDING_MCP_AUTH && key !== MESSAGE_CUSTOM_KEY.MCP_SERVERS,
    ),
  );
}

function omitMcpAuthHintText(content: readonly AssistantContentPart[]): AssistantContentPart[] {
  return content.filter(part => !(part.type === 'text' && part.text === MCP_AUTH_HINT_TEXT));
}

/**
 * Clears Connect chrome as soon as Continue is sent so the prompt cannot be
 * clicked twice while the turn is still catching up. Also marks the tip running
 * so Working... shows immediately (not a blank gap until SSE resumes).
 * Stream updates can put Connect back if auth is still required.
 */
export function withOptimisticMcpAuthContinue(snapshot: SessionSnapshot): SessionSnapshot {
  const active = snapshot.activeStream;
  if (active == null) {
    return replaceSessionSnapshot(snapshot, { pendingMcpAuth: undefined });
  }

  const priorCustom = active.update.metadata?.custom;
  const hadOnlyMcpAuth =
    priorCustom?.[MESSAGE_CUSTOM_KEY.PENDING_MCP_AUTH] === true &&
    priorCustom[MESSAGE_CUSTOM_KEY.TOOL_APPROVAL_THREAD_ID] == null &&
    priorCustom[MESSAGE_CUSTOM_KEY.TOOL_RESPONSE_THREAD_ID] == null;
  const custom = priorCustom == null ? undefined : omitMcpAuthMessageCustom(priorCustom);

  if (!hadOnlyMcpAuth) {
    return replaceSessionSnapshot(snapshot, {
      pendingMcpAuth: undefined,
      activeStream: {
        ...active,
        update: {
          ...active.update,
          ...(custom == null
            ? {}
            : {
                metadata: {
                  ...active.update.metadata,
                  custom,
                },
              }),
        },
      },
    });
  }

  const runningTurn =
    snapshot.runningTurn == null
      ? undefined
      : {
          ...snapshot.runningTurn,
          state: { status: TURN_STATUS.RUNNING },
        };

  return replaceSessionSnapshot(snapshot, {
    pendingMcpAuth: undefined,
    ...(runningTurn != null ? { runningTurn } : {}),
    activeStream: {
      ...active,
      segmentStatus: STREAM_SEGMENT_STATUS.OPEN,
      update: {
        ...active.update,
        content: omitMcpAuthHintText(active.update.content),
        status: runningAssistantStatus(),
        turnState: { status: TURN_STATUS.RUNNING },
        ...(custom == null
          ? {}
          : {
              metadata: {
                ...active.update.metadata,
                custom,
              },
            }),
      },
    },
  });
}

/** Undoes {@link withOptimisticMcpAuthContinue} when Continue fails to send. */
export function restoreMcpAuthAfterFailedContinue({
  current,
  beforeContinue,
}: {
  current: SessionSnapshot;
  beforeContinue: SessionSnapshot;
}): SessionSnapshot {
  if (current.pendingMcpAuth != null) {
    return current;
  }
  const priorPending = beforeContinue.pendingMcpAuth;
  const priorActive = beforeContinue.activeStream;
  const priorCustom = priorActive?.update.metadata?.custom;
  const priorServers = priorCustom?.[MESSAGE_CUSTOM_KEY.MCP_SERVERS];
  const restoredMcpCustom =
    priorCustom?.[MESSAGE_CUSTOM_KEY.PENDING_MCP_AUTH] === true && isMcpServerAuthInfoList(priorServers)
      ? mcpAuthMessageCustom(priorServers)
      : undefined;
  if (priorPending == null && restoredMcpCustom == null) {
    return current;
  }

  const active = current.activeStream ?? priorActive;
  if (active == null) {
    return replaceSessionSnapshot(current, {
      ...(priorPending != null ? { pendingMcpAuth: priorPending } : {}),
      ...(beforeContinue.runningTurn != null ? { runningTurn: beforeContinue.runningTurn } : {}),
    });
  }

  return replaceSessionSnapshot(current, {
    ...(priorPending != null ? { pendingMcpAuth: priorPending } : {}),
    ...(beforeContinue.runningTurn != null ? { runningTurn: beforeContinue.runningTurn } : {}),
    activeStream: {
      ...active,
      ...(priorActive != null ? { segmentStatus: priorActive.segmentStatus } : {}),
      update: {
        ...active.update,
        ...(priorActive != null
          ? {
              content: priorActive.update.content,
              status: priorActive.update.status,
              turnState: priorActive.update.turnState,
            }
          : {}),
        metadata: {
          ...active.update.metadata,
          custom: {
            ...active.update.metadata?.custom,
            ...restoredMcpCustom,
          },
        },
      },
    },
  });
}
