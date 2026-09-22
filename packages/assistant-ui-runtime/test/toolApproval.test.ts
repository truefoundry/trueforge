import { describe, expect, it } from 'vitest';

import {
  applyApprovalDecisionsToMessage,
  collectApprovalInputs,
  messageHasPendingApprovals,
} from '../src/toolApproval.js';

describe('toolApproval', () => {
  it('detects pending nested approvals', () => {
    const message = {
      id: 'a1',
      role: 'assistant' as const,
      content: [
        {
          type: 'tool-call' as const,
          toolCallId: 'tc-root',
          toolName: 'create_sub_agent',
          args: {},
          argsText: '{}',
          messages: [
            {
              id: 'sub',
              role: 'assistant' as const,
              content: [
                {
                  type: 'tool-call' as const,
                  toolCallId: 'tc-sub',
                  toolName: 'bash',
                  args: {},
                  argsText: '{}',
                  approval: { id: 'approval-sub' },
                },
              ],
              status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
              createdAt: new Date(),
              metadata: {
                unstable_state: null,
                unstable_annotations: [],
                unstable_data: [],
                steps: [],
                custom: {},
              },
            },
          ],
        },
      ],
      status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
      createdAt: new Date(),
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {},
      },
    };

    expect(messageHasPendingApprovals(message)).toBe(true);
  });

  it('collects decided approvals for sdk resume', () => {
    const pending = {
      id: 'a1',
      role: 'assistant' as const,
      content: [
        {
          type: 'tool-call' as const,
          toolCallId: 'approval-1',
          toolName: 'bash',
          args: {},
          argsText: '{}',
          approval: { id: 'approval-1' },
        },
      ],
      status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
      createdAt: new Date(),
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: {},
      },
    };

    const decided = applyApprovalDecisionsToMessage(pending, {
      approvalId: 'approval-1',
      approved: true,
    });

    expect(messageHasPendingApprovals(decided)).toBe(false);
    const inputs = collectApprovalInputs(decided, 'main');
    expect(inputs).toEqual([
      {
        type: 'user.tool_approval',
        threadId: 'main',
        toolCallId: 'approval-1',
        approval: { status: 'allow' },
      },
    ]);
  });

  it('collects root approvals when custom thread id metadata is present', () => {
    const pending = {
      id: 'turn-1-assistant',
      role: 'assistant' as const,
      content: [
        {
          type: 'tool-call' as const,
          toolCallId: 'approval-1',
          toolName: 'bash',
          args: {},
          argsText: '{}',
          approval: { id: 'approval-1' },
        },
      ],
      status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
      createdAt: new Date(),
      metadata: {
        unstable_state: null,
        unstable_annotations: [],
        unstable_data: [],
        steps: [],
        custom: { toolApprovalThreadId: 'main' },
      },
    };

    const decided = applyApprovalDecisionsToMessage(pending, {
      approvalId: 'approval-1',
      approved: true,
    });

    expect(messageHasPendingApprovals(decided)).toBe(false);
    expect(collectApprovalInputs(decided, 'main')).toHaveLength(1);
  });
});
