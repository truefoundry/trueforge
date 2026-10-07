import { describe, expect, it } from 'vitest';

import { ROOT_THREAD_ID } from '../src/constants.js';
import {
  collectRequiredActionInputs,
  findCurrentPausedAssistantMessage,
  messageHasPendingRequiredActions,
} from '../src/requiredActionInputs.js';
import { applyApprovalDecisionsToMessage, collectApprovalInputs } from '../src/toolApproval.js';
import { applyToolResponseToMessage } from '../src/toolResponse.js';

describe('findCurrentPausedAssistantMessage', () => {
  const paused = {
    id: 'paused',
    role: 'assistant' as const,
    content: [],
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

  it('returns the current requires-action assistant', () => {
    expect(findCurrentPausedAssistantMessage([paused])).toBe(paused);
  });

  it('skips a trailing non-paused assistant', () => {
    const running = {
      ...paused,
      id: 'running',
      status: { type: 'running' as const },
    };
    expect(findCurrentPausedAssistantMessage([paused, running])).toBe(paused);
  });

  it('returns undefined when a later user message abandoned the pause', () => {
    const user = {
      id: 'u1',
      role: 'user' as const,
      content: [{ type: 'text' as const, text: 'next' }],
      attachments: [],
      createdAt: new Date(),
      metadata: { custom: {} },
    };
    expect(findCurrentPausedAssistantMessage([paused, user])).toBeUndefined();
  });
});

describe('requiredActionInputs', () => {
  describe('batched resume invariant', () => {
    it('bundles approvals and responses once nothing is pending', () => {
      const message = {
        id: 'turn-1-assistant',
        role: 'assistant' as const,
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: 'approval-1',
            toolName: 'bash',
            args: {},
            argsText: '{}',
            approval: { id: 'approval-1', approved: true },
          },
          {
            type: 'tool-call' as const,
            toolCallId: 'question-1',
            toolName: 'ask_user_question',
            args: {},
            argsText: '{}',
            interrupt: { type: 'human' as const, payload: { question: 'Q?' } },
            result: 'answer',
          },
        ],
        status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
        createdAt: new Date(),
        metadata: {
          unstable_state: null,
          unstable_annotations: [],
          unstable_data: [],
          steps: [],
          custom: {
            toolApprovalThreadId: ROOT_THREAD_ID,
            toolResponseThreadId: ROOT_THREAD_ID,
          },
        },
      };

      expect(messageHasPendingRequiredActions(message)).toBe(false);
      expect(collectRequiredActionInputs(message)).toEqual([
        {
          type: 'user.tool_approval',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'approval-1',
          approval: { status: 'allow' },
        },
        {
          type: 'user.tool_response',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'question-1',
          content: 'answer',
        },
      ]);
    });

    it('returns empty inputs while any required action is still pending', () => {
      const pendingApproval = {
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
          {
            type: 'tool-call' as const,
            toolCallId: 'question-1',
            toolName: 'ask_user_question',
            args: {},
            argsText: '{}',
            interrupt: { type: 'human' as const, payload: { question: 'Q?' } },
            result: 'answer',
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

      expect(messageHasPendingRequiredActions(pendingApproval)).toBe(true);
      expect(collectRequiredActionInputs(pendingApproval)).toEqual([]);
    });

    it('collects nested thread ids independently', () => {
      const message = {
        id: 'root-assistant',
        role: 'assistant' as const,
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: 'spawn-1',
            toolName: 'create_sub_agent',
            args: {},
            argsText: '{}',
            messages: [
              {
                id: 'child-assistant',
                role: 'assistant' as const,
                content: [
                  {
                    type: 'tool-call' as const,
                    toolCallId: 'approval-sub',
                    toolName: 'bash',
                    args: {},
                    argsText: '{}',
                    approval: { id: 'approval-sub', approved: true },
                  },
                ],
                status: {
                  type: 'requires-action' as const,
                  reason: 'tool-calls' as const,
                },
                createdAt: new Date(),
                metadata: {
                  unstable_state: null,
                  unstable_annotations: [],
                  unstable_data: [],
                  steps: [],
                  custom: { toolApprovalThreadId: 'child-1' },
                },
              },
            ],
          },
          {
            type: 'tool-call' as const,
            toolCallId: 'approval-root',
            toolName: 'bash',
            args: {},
            argsText: '{}',
            approval: { id: 'approval-root', approved: true },
          },
        ],
        status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
        createdAt: new Date(),
        metadata: {
          unstable_state: null,
          unstable_annotations: [],
          unstable_data: [],
          steps: [],
          custom: { toolApprovalThreadId: ROOT_THREAD_ID },
        },
      };

      expect(collectApprovalInputs(message, ROOT_THREAD_ID)).toEqual([
        {
          type: 'user.tool_approval',
          threadId: 'child-1',
          toolCallId: 'approval-sub',
          approval: { status: 'allow' },
        },
        {
          type: 'user.tool_approval',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'approval-root',
          approval: { status: 'allow' },
        },
      ]);
    });

    it('collects both action types after approvals and responses are staged', () => {
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
          {
            type: 'tool-call' as const,
            toolCallId: 'question-1',
            toolName: 'ask_user_question',
            args: {},
            argsText: '{}',
            interrupt: {
              type: 'human' as const,
              payload: { question: 'Pick one', options: ['A', 'B'] },
            },
          },
        ],
        status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
        createdAt: new Date(),
        metadata: {
          unstable_state: null,
          unstable_annotations: [],
          unstable_data: [],
          steps: [],
          custom: {
            toolApprovalThreadId: ROOT_THREAD_ID,
            toolResponseThreadId: ROOT_THREAD_ID,
          },
        },
      };

      const decided = applyApprovalDecisionsToMessage(pending, {
        approvalId: 'approval-1',
        approved: true,
      });
      expect(messageHasPendingRequiredActions(decided)).toBe(true);
      expect(collectRequiredActionInputs(decided)).toEqual([]);

      const answered = applyToolResponseToMessage(decided, {
        toolCallId: 'question-1',
        content: 'A',
      });
      expect(messageHasPendingRequiredActions(answered)).toBe(false);
      expect(collectRequiredActionInputs(answered)).toEqual([
        {
          type: 'user.tool_approval',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'approval-1',
          approval: { status: 'allow' },
        },
        {
          type: 'user.tool_response',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'question-1',
          content: 'A',
        },
      ]);
    });

    it('does not emit approval-only inputs while a response is still pending', () => {
      const approvalDecidedResponsePending = applyApprovalDecisionsToMessage(
        {
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
            {
              type: 'tool-call' as const,
              toolCallId: 'question-1',
              toolName: 'ask_user_question',
              args: {},
              argsText: '{}',
              interrupt: {
                type: 'human' as const,
                payload: { question: 'Pick one' },
              },
            },
          ],
          status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
          createdAt: new Date(),
          metadata: {
            unstable_state: null,
            unstable_annotations: [],
            unstable_data: [],
            steps: [],
            custom: {
              toolApprovalThreadId: ROOT_THREAD_ID,
              toolResponseThreadId: ROOT_THREAD_ID,
            },
          },
        },
        { approvalId: 'approval-1', approved: true },
      );

      expect(collectApprovalInputs(approvalDecidedResponsePending, ROOT_THREAD_ID)).toEqual([
        {
          type: 'user.tool_approval',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'approval-1',
          approval: { status: 'allow' },
        },
      ]);
      expect(collectRequiredActionInputs(approvalDecidedResponsePending)).toEqual([]);
    });

    it('bundles nested multi-thread approvals and responses in one input array', () => {
      const pending = {
        id: 'root-assistant',
        role: 'assistant' as const,
        content: [
          {
            type: 'tool-call' as const,
            toolCallId: 'spawn-1',
            toolName: 'create_sub_agent',
            args: {},
            argsText: '{}',
            messages: [
              {
                id: 'child-assistant',
                role: 'assistant' as const,
                content: [
                  {
                    type: 'tool-call' as const,
                    toolCallId: 'question-sub',
                    toolName: 'ask_user_question',
                    args: {},
                    argsText: '{}',
                    interrupt: {
                      type: 'human' as const,
                      payload: { question: 'Sub?' },
                    },
                  },
                ],
                status: {
                  type: 'requires-action' as const,
                  reason: 'tool-calls' as const,
                },
                createdAt: new Date(),
                metadata: {
                  unstable_state: null,
                  unstable_annotations: [],
                  unstable_data: [],
                  steps: [],
                  custom: { toolResponseThreadId: 'child-1' },
                },
              },
            ],
          },
          {
            type: 'tool-call' as const,
            toolCallId: 'approval-root',
            toolName: 'bash',
            args: {},
            argsText: '{}',
            approval: { id: 'approval-root' },
          },
        ],
        status: { type: 'requires-action' as const, reason: 'tool-calls' as const },
        createdAt: new Date(),
        metadata: {
          unstable_state: null,
          unstable_annotations: [],
          unstable_data: [],
          steps: [],
          custom: { toolApprovalThreadId: ROOT_THREAD_ID },
        },
      };

      const answered = applyToolResponseToMessage(
        applyApprovalDecisionsToMessage(pending, {
          approvalId: 'approval-root',
          approved: true,
        }),
        { toolCallId: 'question-sub', content: 'sub-answer' },
      );

      expect(collectRequiredActionInputs(answered)).toEqual([
        {
          type: 'user.tool_approval',
          threadId: ROOT_THREAD_ID,
          toolCallId: 'approval-root',
          approval: { status: 'allow' },
        },
        {
          type: 'user.tool_response',
          threadId: 'child-1',
          toolCallId: 'question-sub',
          content: 'sub-answer',
        },
      ]);
    });
  });
});
