import { EventType, MAIN_THREAD_ID, type SessionEventItem } from '@truefoundry/trueforge-core/agent-session';
import {
  assertTranscriptHasInstructionSignal,
  buildInstructionGenerationPrompt,
  extractChatTranscript,
  INSUFFICIENT_SIGNAL_TOKEN,
  InsufficientChatSignalError,
  parseGeneratedInstructions,
  sourcesFromTranscript,
} from '../../../src/runtime/chatInstructionTranscript';

function userTurn(input: { turnId: string; text: string; eventId: string }): SessionEventItem {
  return {
    turn_id: input.turnId,
    event: {
      type: EventType.TURN_CREATED,
      id: input.eventId,
      turn_id: input.turnId,
      previous_turn_id: null,
      input: [{ type: EventType.USER_MESSAGE, content: input.text }],
      state: { status: 'running' },
      created_at: '2026-08-01T00:00:00.000Z',
      thread_id: null,
    },
  };
}

function assistantMessage(input: {
  turnId: string;
  text: string;
  eventId: string;
  threadId?: string;
}): SessionEventItem {
  return {
    turn_id: input.turnId,
    event: {
      type: EventType.MODEL_MESSAGE,
      id: input.eventId,
      thread_id: input.threadId ?? MAIN_THREAD_ID,
      created_at: '2026-08-01T00:00:01.000Z',
      content: input.text,
    },
  };
}

describe('chatInstructionTranscript', () => {
  it('reads user turns and root assistant replies in chronological order', () => {
    const lines = extractChatTranscript([
      assistantMessage({ turnId: 't2', text: 'I will use a changelog format.', eventId: 'e4' }),
      userTurn({
        turnId: 't2',
        text: 'Always summarize PRs as a changelog with breaking changes last.',
        eventId: 'e3',
      }),
      assistantMessage({ turnId: 't1', text: 'Hi, how can I help?', eventId: 'e2' }),
      userTurn({ turnId: 't1', text: 'Hello', eventId: 'e1' }),
    ]);

    expect(lines.map(line => `${line.role}:${line.text}`)).toEqual([
      'user:Hello',
      'assistant:Hi, how can I help?',
      'user:Always summarize PRs as a changelog with breaking changes last.',
      'assistant:I will use a changelog format.',
    ]);
  });

  it('keeps multiple user messages in one turn in chronological order', () => {
    const lines = extractChatTranscript([
      {
        turn_id: 't1',
        event: {
          type: EventType.TURN_CREATED,
          id: 'e1',
          turn_id: 't1',
          previous_turn_id: null,
          input: [
            { type: EventType.USER_MESSAGE, content: 'First preference: be terse.' },
            { type: EventType.USER_MESSAGE, content: 'Second preference: use a changelog.' },
          ],
          state: { status: 'running' },
          created_at: '2026-08-01T00:00:00.000Z',
          thread_id: null,
        },
      },
    ]);
    expect(lines.map(line => line.text)).toEqual([
      'First preference: be terse.',
      'Second preference: use a changelog.',
    ]);
  });

  it('skips subagent replies', () => {
    const lines = extractChatTranscript([
      assistantMessage({
        turnId: 't1',
        text: 'Subagent noise',
        eventId: 'e2',
        threadId: 'child-1',
      }),
      userTurn({
        turnId: 't1',
        text: 'Write release notes in the house style, never mention internal ticket ids.',
        eventId: 'e1',
      }),
    ]);
    expect(lines).toEqual([
      {
        turn_id: 't1',
        role: 'user',
        text: 'Write release notes in the house style, never mention internal ticket ids.',
      },
    ]);
  });

  it('rejects greetings that do not establish behavior', () => {
    const lines = extractChatTranscript([
      assistantMessage({ turnId: 't1', text: 'Hi!', eventId: 'e2' }),
      userTurn({ turnId: 't1', text: 'hey', eventId: 'e1' }),
    ]);
    expect(() => assertTranscriptHasInstructionSignal(lines)).toThrow(InsufficientChatSignalError);
  });

  it('keeps earlier user preferences when a long latest assistant reply exceeds the budget', () => {
    const userText =
      'You are a release notes writer. Always group changes by feature, bugfix, and breaking. Never mention Jira keys.';
    const lines = extractChatTranscript([
      assistantMessage({ turnId: 't2', text: 'x'.repeat(20_000), eventId: 'e4' }),
      userTurn({ turnId: 't2', text: 'Thanks.', eventId: 'e3' }),
      assistantMessage({ turnId: 't1', text: 'Got it.', eventId: 'e2' }),
      userTurn({ turnId: 't1', text: userText, eventId: 'e1' }),
    ]);
    const userChars = lines.filter(line => line.role === 'user').reduce((sum, line) => sum + line.text.length, 0);
    expect(lines.some(line => line.text.includes('Never mention Jira keys'))).toBe(true);
    expect(userChars).toBeGreaterThanOrEqual(80);
    expect(() => assertTranscriptHasInstructionSignal(lines)).not.toThrow();
  });

  it('does not let a long assistant reply pad a short user greeting past the gate', () => {
    const canned =
      'I am a helpful assistant. I can write code, summarize documents, and answer questions about your project in as much detail as you would like.';
    const lines = extractChatTranscript([
      assistantMessage({ turnId: 't1', text: canned, eventId: 'e2' }),
      userTurn({ turnId: 't1', text: 'hi', eventId: 'e1' }),
    ]);
    expect(canned.length).toBeGreaterThan(80);
    expect(() => assertTranscriptHasInstructionSignal(lines)).toThrow(InsufficientChatSignalError);
  });

  it('accepts a long user preference even without an assistant reply', () => {
    const lines = extractChatTranscript([
      userTurn({
        turnId: 't1',
        text: 'You are a release notes writer. Always group changes by feature, bugfix, and breaking. Never mention Jira keys.',
        eventId: 'e1',
      }),
    ]);
    expect(() => assertTranscriptHasInstructionSignal(lines)).not.toThrow();
  });

  it('treats INSUFFICIENT_SIGNAL and generic helper one-liners as a failed draft', () => {
    expect(() => parseGeneratedInstructions(INSUFFICIENT_SIGNAL_TOKEN)).toThrow(InsufficientChatSignalError);
    expect(() => parseGeneratedInstructions('You are a helpful assistant.')).toThrow(InsufficientChatSignalError);
    expect(parseGeneratedInstructions('```\nAlways reply with a changelog grouped by feature.\n```')).toBe(
      'Always reply with a changelog grouped by feature.',
    );
  });

  it('builds a prompt that includes current instructions and the transcript', () => {
    const prompt = buildInstructionGenerationPrompt({
      currentInstructions: 'Be terse.',
      lines: [
        { turn_id: 't1', role: 'user', text: 'Prefer bullet lists.' },
        { turn_id: 't1', role: 'assistant', text: 'Understood.' },
      ],
    });
    expect(prompt.user).toContain('Be terse.');
    expect(prompt.user).toContain('[user] Prefer bullet lists.');
    expect(prompt.system).toContain(INSUFFICIENT_SIGNAL_TOKEN);
  });

  it('caps sources to the most recent lines', () => {
    const sources = sourcesFromTranscript([
      { turn_id: 't1', role: 'user', text: 'First' },
      { turn_id: 't1', role: 'assistant', text: 'Second' },
    ]);
    expect(sources[0]).toEqual({ turn_id: 't1', role: 'user', excerpt: 'First' });
  });
});
