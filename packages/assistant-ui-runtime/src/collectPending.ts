import type { ThreadAssistantMessagePart, ThreadMessage } from '@assistant-ui/core';
import type { McpAuthRequiredEvent } from './server/index.js';

import { ROOT_THREAD_ID } from './constants.js';
import {
  resolveToolApprovalPolicyTarget,
  type PeerThreadFoldState,
  type ToolApprovalPolicyTarget,
} from './foldPeerThreads.js';
import { isMcpServerAuthInfoList, isUnknownRecord, MESSAGE_CUSTOM_KEY } from './messageCustomMetadata.js';
import { findPausedAssistantMessage } from './requiredActionInputs.js';
import { getToolApprovalThreadId, hasPendingToolApproval } from './toolApproval.js';
import {
  getToolResponseThreadId,
  hasPendingToolResponse,
  type AskUserQuestionInterruptPayload,
} from './toolResponse.js';

export interface PendingApproval {
  approvalId: string;
  threadId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
  /** `(serverName, name)` a session / timed allow policy would apply to; absent when none can. */
  policyTarget?: ToolApprovalPolicyTarget;
}

export interface PendingToolResponse {
  toolCallId: string;
  threadId: string;
  toolName: string;
  args: Record<string, unknown>;
  argsText: string;
  question?: string;
  options?: string[];
}

type ToolCallPart = Extract<ThreadMessage['content'][number], { type: 'tool-call' }>;

function walkToolCallParts(
  content: readonly ThreadAssistantMessagePart[],
  visit: (part: ToolCallPart, threadId: string) => void,
  threadId: string,
): void {
  for (const part of content) {
    if (part.type !== 'tool-call') {
      continue;
    }
    visit(part, threadId);
    if (part.messages == null) {
      continue;
    }
    for (const message of part.messages) {
      if (message.role !== 'assistant') {
        continue;
      }
      const nestedThreadId = getToolApprovalThreadId(message) ?? getToolResponseThreadId(message) ?? threadId;
      walkToolCallParts(message.content, visit, nestedThreadId);
    }
  }
}

/** Projected tool-call parts carry no `toolInfo`; pass `fold` to resolve each approval's policy target. */
export function collectPendingApprovals(
  messages: readonly ThreadMessage[],
  fold?: PeerThreadFoldState,
): PendingApproval[] {
  const pending: PendingApproval[] = [];
  const paused = findPausedAssistantMessage(messages);
  if (paused == null) {
    return pending;
  }

  const rootThreadId = getToolApprovalThreadId(paused) ?? ROOT_THREAD_ID;
  walkToolCallParts(
    paused.content,
    (part, threadId) => {
      const approval = part.approval;
      if (approval == null || !hasPendingToolApproval(approval)) {
        return;
      }
      const policyTarget =
        fold == null ? undefined : resolveToolApprovalPolicyTarget({ state: fold, threadId, toolCallId: approval.id });
      pending.push({
        approvalId: approval.id,
        threadId,
        toolName: part.toolName,
        args: { ...part.args },
        argsText: part.argsText,
        ...(policyTarget == null ? {} : { policyTarget }),
      });
    },
    rootThreadId,
  );

  return pending;
}

export function collectPendingToolResponses(messages: readonly ThreadMessage[]): PendingToolResponse[] {
  const pending: PendingToolResponse[] = [];
  const paused = findPausedAssistantMessage(messages);
  if (paused == null) {
    return pending;
  }

  const rootThreadId = getToolResponseThreadId(paused) ?? ROOT_THREAD_ID;
  walkToolCallParts(
    paused.content,
    (part, threadId) => {
      if (!hasPendingToolResponse(part)) {
        return;
      }
      const payload: AskUserQuestionInterruptPayload | undefined = isUnknownRecord(part.interrupt?.payload)
        ? {
            ...(typeof part.interrupt.payload['question'] === 'string'
              ? { question: part.interrupt.payload['question'] }
              : {}),
            ...(Array.isArray(part.interrupt.payload['options']) &&
            part.interrupt.payload['options'].every(option => typeof option === 'string')
              ? { options: part.interrupt.payload['options'] }
              : {}),
          }
        : undefined;
      pending.push({
        toolCallId: part.toolCallId,
        threadId,
        toolName: part.toolName,
        args: { ...part.args },
        argsText: part.argsText,
        ...(payload?.question != null ? { question: payload.question } : {}),
        ...(payload?.options != null ? { options: payload.options } : {}),
      });
    },
    rootThreadId,
  );

  return pending;
}

export function derivePendingMcpAuth(
  messages: readonly ThreadMessage[],
): { mcpServers: McpAuthRequiredEvent['mcpServers'] } | null {
  const paused = findPausedAssistantMessage(messages);
  if (paused == null) {
    return null;
  }
  const custom = paused.metadata.custom;
  if (custom[MESSAGE_CUSTOM_KEY.PENDING_MCP_AUTH] !== true) {
    return null;
  }
  const servers = custom[MESSAGE_CUSTOM_KEY.MCP_SERVERS];
  if (!isMcpServerAuthInfoList(servers)) {
    return { mcpServers: [] };
  }
  return { mcpServers: servers };
}

const UPDATE_CURRENT_SESSION_TOOL_NAME = 'update_current_session';
/** Mirrors `TRUEFORGE_MCP_ID` in trueforge-core. This package does not depend on it. */
const TRUEFORGE_MCP_SERVER_ID = 'trueforge:mcp';

function isUpdateCurrentSessionCall(part: ToolCallPart): boolean {
  // The TrueForge server is deferred, so its tools arrive as `call_tool` and the
  // target server is the `mcp_server` argument. A same-named tool on another server
  // must not refresh this session's spec.
  return (
    part.toolName === 'call_tool' &&
    part.args['tool_name'] === UPDATE_CURRENT_SESSION_TOOL_NAME &&
    part.args['mcp_server'] === TRUEFORGE_MCP_SERVER_ID
  );
}

/** Tool call id of the latest finished `update_current_session` call, which rewrites the session's spec. */
export function findLatestSessionSpecUpdate(messages: readonly ThreadMessage[]): string | undefined {
  let latest: string | undefined;
  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    walkToolCallParts(
      message.content,
      part => {
        if (part.result !== undefined && isUpdateCurrentSessionCall(part)) {
          latest = part.toolCallId;
        }
      },
      ROOT_THREAD_ID,
    );
  }
  return latest;
}

/**
 * Most recent `sandboxId` observed anywhere in the conversation, scanning backward.
 * Unlike `derivePendingMcpAuth`, this isn't gated on message status: once a sandbox
 * is created it stays valid for the rest of the session, not just the paused message.
 */
export function deriveSandboxId(messages: readonly ThreadMessage[]): string | undefined {
  for (const message of messages.toReversed()) {
    if (message.role !== 'assistant') {
      continue;
    }
    const sandboxId = message.metadata.custom[MESSAGE_CUSTOM_KEY.SANDBOX_ID];
    if (typeof sandboxId === 'string') {
      return sandboxId;
    }
  }
  return undefined;
}
