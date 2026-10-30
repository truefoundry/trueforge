import {
  activePath,
  askUserQuestionsByToolCallId,
  buildExchanges,
  exchangeReadiness,
  MAX_MEMORY_MESSAGE_CHARS,
  renderExchange,
  resumePoint,
  type TurnExchange,
} from '../../../src/memory/exchanges';
import { answer, askCall, at, doneState, pausedState, reply, RUNNING, T0, turn, userMessage } from './turnFixtures';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** u1 asks dinner ideas → agent asks a question (paused) → a2 answers → agent replies. */
function pausedThenAnsweredTurns() {
  return [
    turn({
      id: 'u1',
      previous: null,
      input: [userMessage('Dinner ideas? I am vegetarian.')],
      state: pausedState({ completedAt: at(MINUTE), toolCallId: 'call-1' }),
      createdAt: at(0),
    }),
    turn({
      id: 'a2',
      previous: 'u1',
      input: [answer({ toolCallId: 'call-1', content: 'South Indian' })],
      state: doneState({ completedAt: at(3 * MINUTE), output: reply('Try lemon rice and rasam.') }),
      createdAt: at(2 * MINUTE),
    }),
  ];
}

function only(exchanges: TurnExchange[]): TurnExchange {
  const [exchange] = exchanges;
  if (exchange === undefined || exchanges.length !== 1) {
    throw new Error(`expected one exchange, got ${String(exchanges.length)}`);
  }
  return exchange;
}

describe('activePath', () => {
  it('follows previous_turn_id from the tip and ignores abandoned branches', () => {
    const turns = [
      turn({
        id: 'a',
        previous: null,
        input: [userMessage('a')],
        state: doneState({ completedAt: at(0), output: null }),
      }),
      turn({
        id: 'b',
        previous: 'a',
        input: [userMessage('b')],
        state: doneState({ completedAt: at(0), output: null }),
      }),
      turn({
        id: 'b2',
        previous: 'a',
        input: [userMessage('b2')],
        state: doneState({ completedAt: at(0), output: null }),
      }),
    ];
    expect(activePath({ turns, tipTurnId: 'b2' }).map(t => t.turn_id)).toEqual(['a', 'b2']);
  });
});

describe('buildExchanges', () => {
  it('keeps a question pause and its answer in one closed exchange', () => {
    const exchange = only(buildExchanges(pausedThenAnsweredTurns()));
    expect(exchange.turns.map(t => t.turn_id)).toEqual(['u1', 'a2']);
    expect(exchange.status).toBe('closed');
    expect(exchange.continuation).toBe(false);
  });

  it('reports a paused exchange and a running exchange', () => {
    const [u1] = pausedThenAnsweredTurns();
    if (u1 === undefined) {
      throw new Error('fixture');
    }
    expect(only(buildExchanges([u1])).status).toBe('paused');
    const running = turn({ id: 'r', previous: null, input: [userMessage('hi')], state: RUNNING });
    expect(only(buildExchanges([running])).status).toBe('running');
  });

  it('closes an exchange the user moved on from, so later exchanges are not held back', () => {
    const [u1] = pausedThenAnsweredTurns();
    if (u1 === undefined) {
      throw new Error('fixture');
    }
    const next = turn({
      id: 'u2',
      previous: 'u1',
      input: [userMessage('Never mind, book a table instead')],
      state: doneState({ completedAt: at(6 * MINUTE), output: reply('Booked for 8pm.') }),
      createdAt: at(5 * MINUTE),
    });
    const exchanges = buildExchanges([u1, next]);
    expect(exchanges.map(e => [e.turns.map(t => t.turn_id), e.status, e.completedAt])).toEqual([
      [['u1'], 'closed', at(MINUTE)],
      [['u2'], 'closed', at(6 * MINUTE)],
    ]);
    const settled = { now: new Date(T0 + 10 * MINUTE), settleMs: MINUTE, pauseTimeoutMs: 12 * HOUR };
    expect(exchanges.map(exchange => exchangeReadiness({ exchange, ...settled }).ready)).toEqual([true, true]);
  });

  it('ends a turn left running (e.g. a crashed executor) when the next user message arrives', () => {
    const stale = turn({ id: 'r', previous: null, input: [userMessage('hi')], state: RUNNING, createdAt: at(0) });
    const next = turn({
      id: 'u2',
      previous: 'r',
      input: [userMessage('hello?')],
      state: doneState({ completedAt: at(3 * MINUTE), output: reply('Hi!') }),
      createdAt: at(2 * MINUTE),
    });
    const [first] = buildExchanges([stale, next]);
    expect(first).toMatchObject({ status: 'closed', completedAt: at(2 * MINUTE) });
  });

  it('marks an exchange that starts with a resume turn as a continuation', () => {
    const [, a2] = pausedThenAnsweredTurns();
    if (a2 === undefined) {
      throw new Error('fixture');
    }
    expect(only(buildExchanges([a2])).continuation).toBe(true);
  });
});

describe('renderExchange', () => {
  it('sends user text, the rewritten answer and the final reply as context only', () => {
    const questions = askUserQuestionsByToolCallId([askCall({ toolCallId: 'call-1', question: 'Which cuisine?' })]);
    const messages = renderExchange({
      exchange: only(buildExchanges(pausedThenAnsweredTurns())),
      questions,
      userName: 'Priya',
      agentName: 'TrueForge',
    });
    expect(messages).toEqual([
      { role: 'user', content: 'Dinner ideas? I am vegetarian.', createdAt: at(0), name: 'Priya', extract: true },
      {
        role: 'user',
        content: '(Answering "Which cuisine?") South Indian',
        createdAt: at(2 * MINUTE),
        name: 'Priya',
        extract: true,
      },
      {
        role: 'assistant',
        content: 'Try lemon rice and rasam.',
        createdAt: at(3 * MINUTE),
        name: 'TrueForge',
        extract: false,
      },
    ]);
  });

  it('uses only the final reply, drops file parts and skips answers to other tools', () => {
    const exchange = only(
      buildExchanges([
        turn({
          id: 'u1',
          previous: null,
          input: [
            {
              type: 'user.message',
              content: [
                { type: 'text', text: 'Summarise this' },
                { type: 'file', name: 'a.pdf', data: 'data:application/pdf;base64,AAAA' },
              ],
            },
          ],
          state: pausedState({ completedAt: at(MINUTE), toolCallId: 'other-tool' }),
        }),
        turn({
          id: 'a2',
          previous: 'u1',
          input: [answer({ toolCallId: 'other-tool', content: 'tool output' })],
          state: doneState({ completedAt: at(2 * MINUTE), output: reply('Final summary') }),
        }),
      ]),
    );
    const messages = renderExchange({
      exchange,
      questions: new Map(),
      userName: 'U',
      agentName: 'A',
    });
    expect(messages.map(m => [m.role, m.content])).toEqual([
      ['user', 'Summarise this'],
      ['assistant', 'Final summary'],
    ]);
  });

  it('omits the reply for a paused exchange and caps long messages', () => {
    const exchange = only(
      buildExchanges([
        turn({
          id: 'u1',
          previous: null,
          input: [userMessage('x'.repeat(MAX_MEMORY_MESSAGE_CHARS + 500))],
          state: pausedState({ completedAt: at(MINUTE), toolCallId: 'call-1' }),
        }),
      ]),
    );
    const messages = renderExchange({
      exchange,
      questions: new Map(),
      userName: 'U',
      agentName: 'A',
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]?.content.length).toBe(MAX_MEMORY_MESSAGE_CHARS);
    expect(messages[0]?.content.endsWith('[truncated]')).toBe(true);
  });
});

describe('exchangeReadiness', () => {
  const options = { settleMs: MINUTE, pauseTimeoutMs: 12 * HOUR };

  it('waits for the settle window, then sends a closed exchange', () => {
    const exchange = only(buildExchanges(pausedThenAnsweredTurns()));
    expect(exchangeReadiness({ exchange, now: new Date(T0 + 3 * MINUTE + 1_000), ...options })).toEqual({
      ready: false,
    });
    expect(exchangeReadiness({ exchange, now: new Date(T0 + 5 * MINUTE), ...options })).toEqual({
      ready: true,
      partial: false,
    });
  });

  it('sends a paused exchange as partial only after the pause timeout', () => {
    const [u1] = pausedThenAnsweredTurns();
    if (u1 === undefined) {
      throw new Error('fixture');
    }
    const exchange = only(buildExchanges([u1]));
    expect(exchangeReadiness({ exchange, now: new Date(T0 + 11 * HOUR), ...options })).toEqual({ ready: false });
    expect(exchangeReadiness({ exchange, now: new Date(T0 + 13 * HOUR), ...options })).toEqual({
      ready: true,
      partial: true,
    });
  });

  it('never sends a running exchange', () => {
    const exchange = only(
      buildExchanges([turn({ id: 'r', previous: null, input: [userMessage('hi')], state: RUNNING })]),
    );
    expect(exchangeReadiness({ exchange, now: new Date(T0 + 24 * HOUR), ...options })).toEqual({ ready: false });
  });
});

describe('resumePoint', () => {
  const closed = (id: string, previous: string | null) =>
    turn({ id, previous, input: [userMessage(id)], state: doneState({ completedAt: at(0), output: null }) });

  it('starts at the beginning, or after the checkpoint when it is on the path', () => {
    const turns = [closed('a', null), closed('b', 'a'), closed('c', 'b')];
    const path = activePath({ turns, tipTurnId: 'c' });
    expect(resumePoint({ path, turns, lastIngestedTurnId: null })).toEqual({ startIndex: 0, forked: false });
    expect(resumePoint({ path, turns, lastIngestedTurnId: 'b' })).toEqual({ startIndex: 2, forked: false });
  });

  it('resumes after the fork point when the checkpoint is on an abandoned branch', () => {
    const turns = [closed('a', null), closed('b', 'a'), closed('c', 'b'), closed('c2', 'b')];
    const path = activePath({ turns, tipTurnId: 'c2' });
    expect(resumePoint({ path, turns, lastIngestedTurnId: 'c' })).toEqual({ startIndex: 2, forked: true });
  });

  it('sends only the new branch after a mid-exchange fork point', () => {
    const [u1, a2] = pausedThenAnsweredTurns();
    if (u1 === undefined || a2 === undefined) {
      throw new Error('fixture');
    }
    const a2Edited = { ...a2, turn_id: 'a2-edit' };
    const turns = [u1, a2, a2Edited, closed('next', 'a2')];
    const path = activePath({ turns, tipTurnId: 'a2-edit' });
    // The checkpoint 'next' is abandoned; u1 was already sent, so the edited answer goes as a continuation.
    expect(resumePoint({ path, turns, lastIngestedTurnId: 'next' })).toEqual({ startIndex: 1, forked: true });
    expect(buildExchanges(path.slice(1))[0]?.continuation).toBe(true);
  });
});
