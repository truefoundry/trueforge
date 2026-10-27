import type { ILLM } from '../../../src/core/llm/ILLM';
import type { ExtendedChatCompletionChunk, RawAssistantMessageWithUsage } from '../../../src/core/llm/LLMTypes';
import { getEmptyUsage } from '../../../src/core/llm/LLMTypes';
import type {
  AgentThreadExecutionEvent,
  AgentThreadExecutionResult,
  AgentThreadSendBatch,
} from '../../../src/core/runtime/AgentThread.types';
import type { AgentThreadOrchestrator } from '../../../src/core/runtime/AgentThreadOrchestrator';

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

/** Consume execute(); return raw events and the generator result. */
export async function runExecute(input: {
  orchestrator: AgentThreadOrchestrator;
  signal?: AbortSignal | undefined;
}): Promise<{ events: AgentThreadExecutionEvent[]; result: AgentThreadExecutionResult }> {
  const events: AgentThreadExecutionEvent[] = [];
  const iterator = input.orchestrator.execute({
    signal: input.signal ?? new AbortController().signal,
  });
  let step = await iterator.next();
  while (!step.done) {
    events.push(step.value);
    step = await iterator.next();
  }
  return { events, result: step.value };
}

/** Consume send() then execute(); return raw events and the generator result. */
export async function runTurn(input: {
  orchestrator: AgentThreadOrchestrator;
  sendBatch: AgentThreadSendBatch;
  signal?: AbortSignal | undefined;
}): Promise<{ events: AgentThreadExecutionEvent[]; result: AgentThreadExecutionResult }> {
  for await (const _event of input.orchestrator.send(input.sendBatch)) {
    void _event;
  }
  return runExecute({ orchestrator: input.orchestrator, signal: input.signal });
}

export function llmCreateInputs(llm: ILLM): unknown[] {
  return jest.mocked(llm).create.mock.calls.map(call => call[0]);
}
