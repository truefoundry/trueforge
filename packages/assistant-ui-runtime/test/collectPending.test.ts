import type { ThreadMessage } from '@assistant-ui/core';
import { describe, expect, it } from 'vitest';

import {
  collectPendingApprovals,
  collectPendingToolResponses,
  derivePendingMcpAuth,
  deriveSandboxId,
} from '../src/collectPending.js';
import { ROOT_THREAD_ID } from '../src/constants.js';
import { TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY } from '../src/toolResponse.js';

function assistantMessage(
  id: string,
  options: {
    custom?: Record<string, unknown>;
    status?: Extract<ThreadMessage, { role: 'assistant' }>['status'];
    content?: Extract<ThreadMessage, { role: 'assistant' }>['content'];
  } = {},
): Extract<ThreadMessage, { role: 'assistant' }> {
  return {
    id,
    role: 'assistant' as const,
    content: options.content ?? [],
    status: options.status ?? { type: 'complete' as const, reason: 'stop' as const },
    createdAt: new Date(),
    metadata: {
      unstable_state: null,
      unstable_annotations: [],
      unstable_data: [],
      steps: [],
      custom: options.custom ?? {},
    },
  };
}

function userMessage(id: string): ThreadMessage {
  return {
    id,
    role: 'user' as const,
    content: [{ type: 'text', text: 'hi' }],
    attachments: [],
    createdAt: new Date(),
    metadata: { custom: {} },
  };
}

describe('deriveSandboxId', () => {
  it('returns undefined when no message ever carried a sandboxId', () => {
    const messages = [userMessage('u1'), assistantMessage('a1')];
    expect(deriveSandboxId(messages)).toBeUndefined();
  });

  it('returns the sandboxId from the most recent message that has one', () => {
    const messages = [
      userMessage('u1'),
      assistantMessage('a1', { custom: { sandboxId: 'sbx-1' } }),
      userMessage('u2'),
      assistantMessage('a2'),
    ];
    expect(deriveSandboxId(messages)).toBe('sbx-1');
  });

  it('prefers a later sandboxId over an earlier one', () => {
    const messages = [
      assistantMessage('a1', { custom: { sandboxId: 'sbx-1' } }),
      assistantMessage('a2', { custom: { sandboxId: 'sbx-2' } }),
    ];
    expect(deriveSandboxId(messages)).toBe('sbx-2');
  });

  it('keeps returning the sandboxId from earlier turns even when later assistant messages lack it', () => {
    const messages = [
      assistantMessage('a1', { custom: { sandboxId: 'sbx-1' } }),
      assistantMessage('a2'),
      assistantMessage('a3'),
    ];
    expect(deriveSandboxId(messages)).toBe('sbx-1');
  });
});

describe('current pause collection', () => {
  const pausedAskUser = assistantMessage('paused', {
    status: { type: 'requires-action', reason: 'tool-calls' },
    custom: { [TOOL_RESPONSE_THREAD_ID_CUSTOM_KEY]: ROOT_THREAD_ID },
    content: [
      {
        type: 'tool-call',
        toolCallId: 'question-1',
        toolName: 'ask_user_question',
        args: {},
        argsText: '{}',
        interrupt: { type: 'human', payload: { question: 'Pick?' } },
      },
    ],
  });

  it('collects pending tool responses from the current pause only', () => {
    expect(collectPendingToolResponses([pausedAskUser])).toHaveLength(1);
  });

  it('ignores an abandoned pause after a later user message', () => {
    const messages = [pausedAskUser, userMessage('u-followup')];
    expect(collectPendingToolResponses(messages)).toEqual([]);
    expect(collectPendingApprovals(messages)).toEqual([]);
    expect(derivePendingMcpAuth(messages)).toBeNull();
  });

  it('derives MCP auth only from the current pause', () => {
    const pausedMcp = assistantMessage('mcp', {
      status: { type: 'requires-action', reason: 'interrupt' },
      custom: {
        pendingMcpAuth: true,
        mcpServers: [{ id: 's1', name: 'GitHub', authUrl: 'https://example.com' }],
      },
    });
    expect(derivePendingMcpAuth([pausedMcp])?.mcpServers).toHaveLength(1);
    expect(derivePendingMcpAuth([pausedMcp, userMessage('u2')])).toBeNull();
  });

  it('collects nested approvals from the current paused message', () => {
    const pausedApproval = assistantMessage('paused-approval', {
      status: { type: 'requires-action', reason: 'tool-calls' },
      content: [
        {
          type: 'tool-call',
          toolCallId: 'approval-1',
          toolName: 'bash',
          args: {},
          argsText: '{}',
          approval: { id: 'approval-1' },
        },
      ],
    });
    expect(collectPendingApprovals([pausedApproval])).toEqual([expect.objectContaining({ approvalId: 'approval-1' })]);
  });
});
