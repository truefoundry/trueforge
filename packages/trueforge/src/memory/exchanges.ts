import type { TurnState } from '@truefoundry/trueforge-core/agent-session';
import { ASK_USER_QUESTION_TOOL_NAME } from '@truefoundry/trueforge-core/core';
import type { MemoryIngestTurn, StoredModelMessage } from '../db/memoryIngestStore';
import type { MemoryMessage } from './MemoryProvider';

/** Per-message cap; Zep rejects message content over 4,096 characters. */
export const MAX_MEMORY_MESSAGE_CHARS = 4_000;
const TRUNCATION_MARKER = ' [truncated]';

/**
 * - `closed`: the last turn is terminal with nothing pending, or a later user message superseded it.
 * - `paused`: the last turn finished waiting on the user (a question, approval or auth).
 * - `running`: the last turn has not finished.
 */
export type ExchangeStatus = 'closed' | 'paused' | 'running';

/** One user request plus the turns that answered it, along the active path. */
export interface TurnExchange {
  turns: [MemoryIngestTurn, ...MemoryIngestTurn[]];
  status: ExchangeStatus;
  /** When the exchange ended; null while it is running. */
  completedAt: string | null;
  /** Starts with a resume turn (e.g. an answer) whose exchange was partly ingested earlier. */
  continuation: boolean;
}

function hasUserMessage(turn: MemoryIngestTurn): boolean {
  return turn.input.some(item => item.type === 'user.message');
}

function statusAfter(state: TurnState): ExchangeStatus {
  switch (state.status) {
    case 'running':
    case 'paused':
      return 'running';
    case 'done':
      return state.required_actions.length === 0 ? 'closed' : 'paused';
    case 'error':
    case 'cancelled':
      return 'closed';
  }
}

/** Root-to-tip turns reachable from the tip through `previous_turn_id`. */
export function activePath({
  turns,
  tipTurnId,
}: {
  turns: readonly MemoryIngestTurn[];
  tipTurnId: string;
}): MemoryIngestTurn[] {
  const byId = new Map(turns.map(turn => [turn.turn_id, turn]));
  const path: MemoryIngestTurn[] = [];
  const seen = new Set<string>();
  let current = byId.get(tipTurnId);
  while (current !== undefined && !seen.has(current.turn_id)) {
    seen.add(current.turn_id);
    path.push(current);
    current = current.previous_turn_id === null ? undefined : byId.get(current.previous_turn_id);
  }
  return path.reverse();
}

/**
 * Groups consecutive turns into exchanges; a turn with a user message starts a new one. An exchange
 * still waiting when the user sends a new message (an ignored question or approval) closes there.
 */
export function buildExchanges(turns: readonly MemoryIngestTurn[]): TurnExchange[] {
  const exchanges: TurnExchange[] = [];
  let current: TurnExchange | undefined;
  for (const turn of turns) {
    if (current !== undefined && hasUserMessage(turn)) {
      current.status = 'closed';
      current.completedAt ??= turn.created_at;
      current = undefined;
    }
    if (current === undefined) {
      current = {
        turns: [turn],
        status: statusAfter(turn.state),
        completedAt: completedAt(turn.state),
        continuation: !hasUserMessage(turn),
      };
      exchanges.push(current);
    } else {
      current.turns.push(turn);
      current.status = statusAfter(turn.state);
      current.completedAt = completedAt(turn.state);
    }
    if (current.status === 'closed') {
      current = undefined;
    }
  }
  return exchanges;
}

/**
 * Index into `path` to resume ingestion from, given the last ingested turn. When that turn is no
 * longer on the active path (the user edited or branched), resume just after the fork point: the
 * shared prefix was already sent, and a resumed answer is sent as a continuation. The abandoned
 * branch stays with the provider.
 */
export function resumePoint({
  path,
  turns,
  lastIngestedTurnId,
}: {
  path: readonly MemoryIngestTurn[];
  turns: readonly MemoryIngestTurn[];
  lastIngestedTurnId: string | null;
}): { startIndex: number; forked: boolean } {
  if (lastIngestedTurnId === null) {
    return { startIndex: 0, forked: false };
  }
  const pathIndex = new Map(path.map((turn, index) => [turn.turn_id, index]));
  const ingestedIndex = pathIndex.get(lastIngestedTurnId);
  if (ingestedIndex !== undefined) {
    return { startIndex: ingestedIndex + 1, forked: false };
  }

  const byId = new Map(turns.map(turn => [turn.turn_id, turn]));
  const seen = new Set<string>();
  let forkIndex: number | undefined;
  let current = byId.get(lastIngestedTurnId);
  while (current !== undefined && !seen.has(current.turn_id) && forkIndex === undefined) {
    seen.add(current.turn_id);
    current = current.previous_turn_id === null ? undefined : byId.get(current.previous_turn_id);
    forkIndex = current === undefined ? undefined : pathIndex.get(current.turn_id);
  }
  return { startIndex: forkIndex === undefined ? 0 : forkIndex + 1, forked: true };
}

function completedAt(state: TurnState): string | null {
  return state.status === 'done' || state.status === 'error' || state.status === 'cancelled'
    ? state.completed_at
    : null;
}

export type ExchangeReadiness = { ready: true; partial: boolean } | { ready: false };

/**
 * Closed exchanges are sent once settled; exchanges paused on the user longer than the pause
 * timeout are sent as they stand (`partial`), and the later answer follows as a continuation.
 */
export function exchangeReadiness({
  exchange,
  now,
  settleMs,
  pauseTimeoutMs,
}: {
  exchange: TurnExchange;
  now: Date;
  settleMs: number;
  pauseTimeoutMs: number;
}): ExchangeReadiness {
  const finishedAt = exchange.completedAt;
  if (exchange.status === 'running' || finishedAt === null) {
    return { ready: false };
  }
  const ageMs = now.getTime() - Date.parse(finishedAt);
  if (exchange.status === 'closed') {
    return ageMs >= settleMs ? { ready: true, partial: false } : { ready: false };
  }
  return ageMs >= pauseTimeoutMs ? { ready: true, partial: true } : { ready: false };
}

/** `ask_user_question` tool call id → question text, from main-thread model messages. */
export function askUserQuestionsByToolCallId(messages: readonly StoredModelMessage[]): Map<string, string> {
  const questions = new Map<string, string>();
  for (const message of messages) {
    for (const call of message.tool_calls ?? []) {
      if (call.function.name !== ASK_USER_QUESTION_TOOL_NAME) {
        continue;
      }
      const question = parseQuestion(call.function.arguments);
      if (question !== undefined) {
        questions.set(call.id, question);
      }
    }
  }
  return questions;
}

function parseQuestion(rawArguments: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(rawArguments);
    if (typeof parsed === 'object' && parsed !== null && 'question' in parsed && typeof parsed.question === 'string') {
      const question = parsed.question.trim();
      return question === '' ? undefined : question;
    }
  } catch {
    // Malformed arguments: the answer is sent without its question.
  }
  return undefined;
}

/** Plain text of a model message's content (text and refusal parts). */
export function modelMessageText(content: StoredModelMessage['content']): string {
  if (content === undefined || content === null) {
    return '';
  }
  if (typeof content === 'string') {
    return content.trim();
  }
  return content
    .map(part => (part.type === 'text' ? part.text : part.refusal))
    .join('')
    .trim();
}

function capped(text: string): string {
  return text.length <= MAX_MEMORY_MESSAGE_CHARS
    ? text
    : text.slice(0, MAX_MEMORY_MESSAGE_CHARS - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}

/**
 * Provider messages for an exchange: the user's messages (text parts only), `ask_user_question`
 * answers rewritten with their question, and the final agent reply as context only. Intermediate
 * tool calls, tool results and sub-agent threads are left out.
 */
export function renderExchange({
  exchange,
  questions,
  userName,
  agentName,
}: {
  exchange: TurnExchange;
  questions: ReadonlyMap<string, string>;
  userName: string;
  agentName: string;
}): MemoryMessage[] {
  const messages: MemoryMessage[] = [];
  const user = (content: string, createdAt: string) => {
    if (content !== '') {
      messages.push({ role: 'user', content: capped(content), createdAt, name: userName, extract: true });
    }
  };

  for (const turn of exchange.turns) {
    for (const item of turn.input) {
      if (item.type === 'user.message') {
        const text =
          typeof item.content === 'string'
            ? item.content
            : item.content.flatMap(part => (part.type === 'text' ? [part.text] : [])).join('\n');
        user(text.trim(), turn.created_at);
      } else if (item.type === 'user.tool_response') {
        const question = questions.get(item.tool_call_id);
        const answer = item.content.trim();
        if (question !== undefined && answer !== '') {
          user(`(Answering "${question}") ${answer}`, turn.created_at);
        }
      }
    }
  }

  const last = exchange.turns[exchange.turns.length - 1];
  if (exchange.status === 'closed' && last?.state.status === 'done' && last.state.output !== null) {
    const reply = modelMessageText(last.state.output.content);
    if (reply !== '') {
      messages.push({
        role: 'assistant',
        content: capped(reply),
        createdAt: last.state.completed_at,
        name: agentName,
        extract: false,
      });
    }
  }
  return messages;
}
