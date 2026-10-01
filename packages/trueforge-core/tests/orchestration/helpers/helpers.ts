import type { ILLM } from '../../../src/core/llm/ILLM';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from '../../../src/core/llm/LLMTypes';
import { getEmptyUsage } from '../../../src/core/llm/LLMTypes';
import {
  InternalEventType,
  type AgentThreadExecutionEvent,
  type AgentThreadExecutionResult,
} from '../../../src/core/runtime/AgentThread.types';

export const WRITE_NOTE_TOOL_NAME = 'write_note';
export const WRITE_NOTE_CALL_ID = 'call-write';
export const WRITE_NOTE_ARGUMENTS = JSON.stringify({ text: 'hello' });
export const WRITE_NOTE_RESULT = 'note written';

/** One streamed chunk plus a stop completion. Used when the test needs a text reply and no tool calls. */
// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
export async function* textReplyStream(
  text: string,
): AsyncGenerator<ExtendedChatCompletionChunk, RawAssistantMessageWithUsage, unknown> {
  yield {
    id: 'chunk-text',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [{ index: 0, delta: { role: 'assistant', content: text }, finish_reason: 'stop' }],
  };
  return {
    output: { role: 'assistant', content: text },
    usage: getEmptyUsage(),
    finish_reason: 'stop',
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
export async function* createSubAgentStream() {
  yield {
    id: 'chunk-tool',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'call-sub',
              type: 'function',
              function: {
                name: 'create_sub_agent',
                arguments: JSON.stringify({ name: 'worker', input: 'do the delegated task' }),
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };

  return {
    output: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'call-sub',
          type: 'function',
          function: {
            name: 'create_sub_agent',
            arguments: JSON.stringify({ name: 'worker', input: 'do the delegated task' }),
          },
        },
      ],
    },
    usage: getEmptyUsage(),
    finish_reason: 'tool_calls',
  };
}

// eslint-disable-next-line @typescript-eslint/require-await -- async generator fixture, not awaiting I/O
export async function* writeNoteToolCallStream() {
  yield {
    id: 'chunk-write-note',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'test-model',
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: WRITE_NOTE_CALL_ID,
              type: 'function',
              function: {
                name: WRITE_NOTE_TOOL_NAME,
                arguments: WRITE_NOTE_ARGUMENTS,
              },
            },
          ],
        },
        finish_reason: 'tool_calls',
      },
    ],
  };

  return {
    output: {
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: WRITE_NOTE_CALL_ID,
          type: 'function',
          function: {
            name: WRITE_NOTE_TOOL_NAME,
            arguments: WRITE_NOTE_ARGUMENTS,
          },
        },
      ],
    },
    usage: getEmptyUsage(),
    finish_reason: 'tool_calls',
  };
}

export type DriveOutcome =
  | { kind: 'paused'; events: AgentThreadExecutionEvent[] }
  | { kind: 'done'; events: AgentThreadExecutionEvent[]; result: AgentThreadExecutionResult };

/**
 * Drive a live `execute()` generator exactly as the production wiring layer would: collect the
 * non-turn-state events and stop when the executor parks (turn-state `paused`) or returns. On a
 * park the generator is left suspended so the caller can resume the SAME `execute()` via
 * `send()` + `notifyWake()`; on done the executor's own terminal result is returned. Nothing is
 * synthesized and resume is never faked — `running` transitions are internal bookkeeping and dropped.
 */
export async function driveUntilPauseOrDone(
  iterator: AsyncGenerator<AgentThreadExecutionEvent, AgentThreadExecutionResult, unknown>,
): Promise<DriveOutcome> {
  const events: AgentThreadExecutionEvent[] = [];
  let step = await iterator.next();
  while (!step.done) {
    const event = step.value;
    if (event.type === InternalEventType.TURN_STATE) {
      if (event.transition.status === 'paused') {
        return { kind: 'paused', events };
      }
      step = await iterator.next();
      continue;
    }
    events.push(event);
    step = await iterator.next();
  }
  return { kind: 'done', events, result: step.value };
}

export function llmCreateInputs(llm: ILLM): unknown[] {
  return jest.mocked(llm).create.mock.calls.map(call => call[0]);
}
