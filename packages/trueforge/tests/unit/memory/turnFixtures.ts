import { MAIN_THREAD_ID, type TurnInputItem, type TurnState } from '@truefoundry/trueforge-core/agent-session';
import { ASK_USER_QUESTION_TOOL_NAME, ModelMessageEventSchema } from '@truefoundry/trueforge-core/core';
import type { MemoryIngestTurn, StoredModelMessage } from '../../../src/db/memoryIngestStore';

export const T0 = Date.parse('2026-10-01T00:00:00.000Z');

export function at(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

export function reply(text: string, id = `msg-${text}`): StoredModelMessage {
  return ModelMessageEventSchema.parse({
    type: 'model.message',
    id,
    thread_id: MAIN_THREAD_ID,
    created_at: at(0),
    content: text,
  });
}

export function askCall({ toolCallId, question }: { toolCallId: string; question: string }): StoredModelMessage {
  return ModelMessageEventSchema.parse({
    type: 'model.message',
    id: `ask-${toolCallId}`,
    thread_id: MAIN_THREAD_ID,
    created_at: at(0),
    content: '',
    tool_calls: [
      {
        id: toolCallId,
        type: 'function',
        function: { name: ASK_USER_QUESTION_TOOL_NAME, arguments: JSON.stringify({ question, options: [] }) },
        tool_info: { type: 'truefoundry-system', name: ASK_USER_QUESTION_TOOL_NAME },
      },
    ],
  });
}

export function doneState({
  completedAt,
  output,
}: {
  completedAt: string;
  output: StoredModelMessage | null;
}): TurnState {
  return { status: 'done', output, required_actions: [], completed_at: completedAt };
}

export function pausedState({ completedAt, toolCallId }: { completedAt: string; toolCallId: string }): TurnState {
  return {
    status: 'done',
    output: null,
    completed_at: completedAt,
    required_actions: [
      {
        type: 'tool.response_required',
        id: `req-${toolCallId}`,
        created_at: completedAt,
        thread_id: MAIN_THREAD_ID,
        tool_calls: [{ id: toolCallId, source_event_id: `ask-${toolCallId}` }],
      },
    ],
  };
}

export const RUNNING: TurnState = { status: 'running' };

export function turn({
  id,
  previous,
  input,
  state,
  createdAt = at(0),
}: {
  id: string;
  previous: string | null;
  input: TurnInputItem[];
  state: TurnState;
  createdAt?: string;
}): MemoryIngestTurn {
  return { turn_id: id, previous_turn_id: previous, input, state, created_at: createdAt };
}

export function userMessage(text: string): TurnInputItem {
  return { type: 'user.message', content: text };
}

export function answer({ toolCallId, content }: { toolCallId: string; content: string }): TurnInputItem {
  return { type: 'user.tool_response', thread_id: MAIN_THREAD_ID, tool_call_id: toolCallId, content };
}
