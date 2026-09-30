import type { ThreadAssistantMessagePart, ThreadMessage } from '@assistant-ui/core';
import type { McpAuthRequiredEvent } from './server/index.js';

import { isRequiresAction } from './assistantMessageStatus.js';
import { ROOT_THREAD_ID } from './constants.js';
import { isMcpServerAuthInfoList, isUnknownRecord, MESSAGE_CUSTOM_KEY } from './messageCustomMetadata.js';
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

export function collectPendingApprovals(messages: readonly ThreadMessage[]): PendingApproval[] {
  const pending: PendingApproval[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    const rootThreadId = getToolApprovalThreadId(message) ?? ROOT_THREAD_ID;
    walkToolCallParts(
      message.content,
      (part, threadId) => {
        const approval = part.approval;
        if (approval == null || !hasPendingToolApproval(approval)) {
          return;
        }
        pending.push({
          approvalId: approval.id,
          threadId,
          toolName: part.toolName,
          args: { ...part.args },
          argsText: part.argsText,
        });
      },
      rootThreadId,
    );
  }

  return pending;
}

export function collectPendingToolResponses(messages: readonly ThreadMessage[]): PendingToolResponse[] {
  const pending: PendingToolResponse[] = [];

  for (const message of messages) {
    if (message.role !== 'assistant') {
      continue;
    }
    const rootThreadId = getToolResponseThreadId(message) ?? ROOT_THREAD_ID;
    walkToolCallParts(
      message.content,
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
  }

  return pending;
}

export function derivePendingMcpAuth(
  messages: readonly ThreadMessage[],
): { mcpServers: McpAuthRequiredEvent['mcpServers'] } | null {
  for (const message of messages.toReversed()) {
    if (message.role !== 'assistant') {
      continue;
    }
    if (!isRequiresAction(message.status)) {
      continue;
    }
    const custom = message.metadata.custom;
    if (custom[MESSAGE_CUSTOM_KEY.PENDING_MCP_AUTH] !== true) {
      continue;
    }
    const servers = custom[MESSAGE_CUSTOM_KEY.MCP_SERVERS];
    if (!isMcpServerAuthInfoList(servers)) {
      return { mcpServers: [] };
    }
    return { mcpServers: servers };
  }
  return null;
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
