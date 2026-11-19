import { describe, expect, it } from 'vitest';

import { ROOT_THREAD_ID } from '../src/constants.js';
import { PeerThreadFoldState } from '../src/foldPeerThreads.js';
import {
  applyToolResponseToMessage,
  applyUserToolResponsesToFold,
  messageHasPendingResponses,
} from '../src/toolResponse.js';

describe('toolResponse', () => {
  it('detects pending nested tool responses', () => {
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
                  toolCallId: 'question-1',
                  toolName: 'ask_user_question',
                  args: { question: 'Pick one' },
                  argsText: '{"question":"Pick one"}',
                  interrupt: {
                    type: 'human' as const,
                    payload: { question: 'Pick one', options: ['A', 'B'] },
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

    expect(messageHasPendingResponses(message)).toBe(true);
  });

  it('applies a tool response to the matching interrupt', () => {
    const pending = {
      id: 'a1',
      role: 'assistant' as const,
      content: [
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
        custom: { toolResponseThreadId: 'main' },
      },
    };

    const answered = applyToolResponseToMessage(pending, {
      toolCallId: 'question-1',
      content: 'A',
    });

    expect(messageHasPendingResponses(answered)).toBe(false);
    expect(answered.content[0]).toMatchObject({ toolCallId: 'question-1', result: 'A' });
  });

  it('applyUserToolResponsesToFold records answers from turn input', () => {
    const fold = new PeerThreadFoldState();
    const bucket = fold.getOrCreateBucket(ROOT_THREAD_ID);
    bucket.pendingResponses.set('question-1', {
      id: 'question-1',
      sourceEventId: 'model-1',
      question: 'Pick one',
    });

    applyUserToolResponsesToFold(fold, [
      {
        type: 'user.tool_response',
        threadId: ROOT_THREAD_ID,
        toolCallId: 'question-1',
        content: 'A',
      },
    ]);

    expect(bucket.pendingResponses.has('question-1')).toBe(false);
    expect(bucket.toolResults.get('question-1')).toBe('A');
  });
});
