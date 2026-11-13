import type { ThreadMessage } from '@assistant-ui/core';
import { describe, expect, it } from 'vitest';

import {
  collectPendingApprovals,
  collectPendingToolResponses,
  derivePendingMcpAuth,
  deriveSandboxId,
  findLatestSessionSpecUpdate,
} from '../src/collectPending.js';
import { ROOT_THREAD_ID } from '../src/constants.js';
import { ingestTurnEvent, PeerThreadFoldState } from '../src/foldPeerThreads.js';
import { MESSAGE_CUSTOM_KEY } from '../src/messageCustomMetadata.js';

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
    custom: { [MESSAGE_CUSTOM_KEY.TOOL_RESPONSE_THREAD_ID]: ROOT_THREAD_ID },
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

  it('resolves the policy target for a direct MCP tool approval from the fold', () => {
    const fold = new PeerThreadFoldState();
    ingestTurnEvent(fold, {
      type: 'model.message',
      id: 'model-1',
      createdAt: new Date().toISOString(),
      threadId: ROOT_THREAD_ID,
      toolCalls: [
        {
          id: 'call-1',
          type: 'function',
          function: { name: 'save_comment', arguments: '{}' },
          toolInfo: { type: 'mcp', name: 'save_comment', serverId: 'linear-id', serverName: 'linear' },
        },
      ],
    });
    const paused = assistantMessage('paused-mcp', {
      status: { type: 'requires-action', reason: 'tool-calls' },
      content: [
        {
          type: 'tool-call',
          toolCallId: 'call-1',
          toolName: 'save_comment',
          args: {},
          argsText: '{}',
          approval: { id: 'call-1' },
        },
      ],
    });

    expect(collectPendingApprovals([paused], fold)).toMatchObject([
      { approvalId: 'call-1', policyTarget: { serverName: 'linear', name: 'save_comment' } },
    ]);
    expect(collectPendingApprovals([paused])[0]?.policyTarget).toBeUndefined();
  });
});

describe('findLatestSessionSpecUpdate', () => {
  function toolCall(toolCallId: string, toolName: string, args: Record<string, string>, result?: string) {
    return {
      type: 'tool-call' as const,
      toolCallId,
      toolName,
      args,
      argsText: JSON.stringify(args),
      ...(result === undefined ? {} : { result }),
    };
  }

  it('returns the latest finished update_current_session call on the TrueForge server', () => {
    const messages = [
      assistantMessage('a1', {
        content: [
          toolCall('first', 'call_tool', { mcp_server: 'trueforge:mcp', tool_name: 'update_current_session' }, '{}'),
        ],
      }),
      userMessage('u2'),
      assistantMessage('a2', {
        content: [
          toolCall('second', 'call_tool', { mcp_server: 'trueforge:mcp', tool_name: 'update_current_session' }, '{}'),
        ],
      }),
    ];
    expect(findLatestSessionSpecUpdate(messages)).toBe('second');
  });

  it('ignores the same tool name on another server, direct calls, and calls still running', () => {
    const messages = [
      assistantMessage('a1', {
        content: [
          toolCall('other-server', 'call_tool', { mcp_server: 'github', tool_name: 'update_current_session' }, '{}'),
          toolCall('direct', 'update_current_session', {}, '{}'),
          toolCall('running', 'call_tool', {
            mcp_server: 'trueforge:mcp',
            tool_name: 'update_current_session',
          }),
          toolCall('done', 'call_tool', { mcp_server: 'trueforge:mcp', tool_name: 'update_current_session' }, '{}'),
        ],
      }),
    ];
    expect(findLatestSessionSpecUpdate(messages)).toBe('done');
  });
});
