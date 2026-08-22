/**
 * Turns a session event log into a bounded chat transcript used to draft
 * system instructions. Kept free of I/O so short-chat rejection is deterministic.
 */
import { EventType, MAIN_THREAD_ID, type SessionEventItem } from '@truefoundry/trueforge-core/agent-session';
import type { ChatInstructionSource } from '../schemas/session';

export const INSUFFICIENT_SIGNAL_TOKEN = 'INSUFFICIENT_SIGNAL';

/** Below this, the chat is greetings and small talk, not durable behavior. */
export const MIN_TRANSCRIPT_CHARS = 80;
const MAX_TRANSCRIPT_CHARS = 12_000;
const MAX_SOURCES = 8;
const EXCERPT_CHARS = 180;
const MIN_INSTRUCTION_CHARS = 24;

const GENERIC_INSTRUCTION = /^(you are (a |an )?(helpful|friendly|useful)( ai| virtual)? assistant\.?)$/i;

export type ChatInstructionRole = 'user' | 'assistant';

export interface ChatInstructionLine {
  turn_id: string;
  role: ChatInstructionRole;
  text: string;
}

export class InsufficientChatSignalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InsufficientChatSignalError';
  }
}

function textFromUnknownContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    return '';
  }
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part !== 'object' || part === null) {
      continue;
    }
    const type: unknown = Reflect.get(part, 'type');
    if (type === 'text') {
      const text: unknown = Reflect.get(part, 'text');
      if (typeof text === 'string' && text.trim() !== '') {
        parts.push(text.trim());
      }
      continue;
    }
    if (type === 'file') {
      const name: unknown = Reflect.get(part, 'name');
      if (typeof name === 'string' && name.trim() !== '') {
        parts.push(`[file: ${name.trim()}]`);
      }
    }
  }
  return parts.join('\n');
}

function excerptFrom(text: string): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= EXCERPT_CHARS) {
    return compact;
  }
  return `${compact.slice(0, EXCERPT_CHARS - 1).trimEnd()}…`;
}

function stripFence(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:[\w-]+)?\n([\s\S]*?)\n```$/.exec(trimmed);
  if (fenced?.[1] !== undefined) {
    return fenced[1].trim();
  }
  return trimmed;
}

/**
 * Walk newest-first events, keep user turns and root-agent replies, then
 * reverse so the prompt reads oldest to newest within the character budget.
 */
export function extractChatTranscript(events: readonly SessionEventItem[]): ChatInstructionLine[] {
  const newestFirst: ChatInstructionLine[] = [];
  let used = 0;

  for (const item of events) {
    if (used >= MAX_TRANSCRIPT_CHARS) {
      break;
    }
    const event = item.event;
    if (event.type === EventType.TURN_CREATED) {
      const input = event.input ?? [];
      for (const part of input) {
        if (part.type !== EventType.USER_MESSAGE) {
          continue;
        }
        const text = textFromUnknownContent(part.content);
        if (text.length === 0) {
          continue;
        }
        const clipped = text.slice(0, MAX_TRANSCRIPT_CHARS - used);
        newestFirst.push({ turn_id: item.turn_id, role: 'user', text: clipped });
        used += clipped.length;
        if (used >= MAX_TRANSCRIPT_CHARS) {
          break;
        }
      }
      continue;
    }
    if (event.type !== EventType.MODEL_MESSAGE || event.thread_id !== MAIN_THREAD_ID) {
      continue;
    }
    const text = textFromUnknownContent(Reflect.get(event, 'content'));
    if (text.length === 0) {
      continue;
    }
    const clipped = text.slice(0, MAX_TRANSCRIPT_CHARS - used);
    newestFirst.push({ turn_id: item.turn_id, role: 'assistant', text: clipped });
    used += clipped.length;
  }

  return newestFirst.reverse();
}

export function sourcesFromTranscript(lines: readonly ChatInstructionLine[]): ChatInstructionSource[] {
  const picked = lines.length <= MAX_SOURCES ? lines : lines.slice(-MAX_SOURCES);
  return picked.map(line => ({
    turn_id: line.turn_id,
    role: line.role,
    excerpt: excerptFrom(line.text),
  }));
}

export function assertTranscriptHasInstructionSignal(lines: readonly ChatInstructionLine[]): void {
  const userCount = lines.filter(line => line.role === 'user').length;
  const totalChars = lines.reduce((sum, line) => sum + line.text.length, 0);
  if (userCount === 0 || totalChars < MIN_TRANSCRIPT_CHARS) {
    throw new InsufficientChatSignalError(
      'This chat is too short to infer durable system instructions. Continue the conversation, or write the instructions yourself.',
    );
  }
}

export function buildInstructionGenerationPrompt(input: {
  currentInstructions: string | undefined;
  lines: readonly ChatInstructionLine[];
}): { system: string; user: string } {
  const current = input.currentInstructions?.trim() ?? '';
  const transcript = input.lines.map(line => `[${line.role}] ${line.text}`).join('\n\n');
  return {
    system: [
      'You extract durable system instructions for an AI agent from a chat transcript.',
      "Write instructions a maintainer would save as the agent's system prompt.",
      'Capture only preferences, constraints, tone, format, and domain the conversation actually established.',
      'Do not invent a persona, tools, or policies the chat did not show.',
      'Do not retell the conversation or quote it at length.',
      `If the chat is too thin to write real instructions, reply with exactly ${INSUFFICIENT_SIGNAL_TOKEN} and nothing else.`,
      'Output plain text only. No title, no markdown fences, no preamble.',
    ].join(' '),
    user: [
      'Current instructions (may be empty):',
      current.length > 0 ? current : '(none)',
      '',
      'Transcript, oldest first:',
      transcript,
      '',
      'Write the system instructions.',
    ].join('\n'),
  };
}

export function parseGeneratedInstructions(raw: string): string {
  const cleaned = stripFence(raw);
  if (cleaned.length === 0 || cleaned.toUpperCase() === INSUFFICIENT_SIGNAL_TOKEN) {
    throw new InsufficientChatSignalError(
      'This chat does not establish how the agent should behave. Continue the conversation, or write the instructions yourself.',
    );
  }
  if (cleaned.length < MIN_INSTRUCTION_CHARS || GENERIC_INSTRUCTION.test(cleaned)) {
    throw new InsufficientChatSignalError(
      'The model could not infer durable instructions from this chat. Continue the conversation, or write them yourself.',
    );
  }
  return cleaned;
}
