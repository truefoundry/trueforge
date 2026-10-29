import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TurnFailedError, TurnStreamDisconnectedError } from '../src/convertTurnMessages.js';
import {
  classifyStreamError,
  createStreamLifecycleReporter,
  type TurnStreamLifecycleEvent,
} from '../src/streamLifecycle.js';

function setup() {
  const events: TurnStreamLifecycleEvent[] = [];
  const reporter = createStreamLifecycleReporter({
    sessionId: 's1',
    getTurnId: () => 't1',
    emit: event => events.push(event),
  });
  return { events, reporter, types: () => events.map(e => e.type) };
}

describe('classifyStreamError', () => {
  it('maps known failures to a reason', () => {
    expect(classifyStreamError(new TurnFailedError('x')).reason).toBe('turn_error');
    expect(classifyStreamError(new TurnStreamDisconnectedError()).reason).toBe('closed_without_done');
    expect(classifyStreamError(new Error('"timeout"')).reason).toBe('timeout');
    expect(classifyStreamError(Object.assign(new Error('bad'), { statusCode: 502 }))).toEqual({
      reason: 'http_error',
      httpStatus: 502,
    });
    expect(classifyStreamError(new TypeError('Failed to fetch')).reason).toBe('network_error');
  });
});

describe('createStreamLifecycleReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('reports a clean turn: started, first_event, completed', () => {
    const { reporter, types, events } = setup();
    reporter.start('create');
    vi.advanceTimersByTime(200);
    reporter.onEvent(1);
    reporter.onEvent(2);
    reporter.completed('done');
    expect(types()).toEqual(['started', 'first_event', 'completed']);
    expect(events[1]).toMatchObject({ type: 'first_event', msToFirstEvent: 200 });
    expect(events[2]).toMatchObject({ type: 'completed', status: 'done', eventCount: 2, reconnectCount: 0 });
  });

  it('emits stalled once per threshold and resets on the next event', () => {
    const { reporter, types } = setup();
    reporter.start('create');
    reporter.onEvent(1);
    vi.advanceTimersByTime(65_000);
    expect(types().filter(t => t === 'stalled')).toHaveLength(2);
    reporter.onEvent(2);
    vi.advanceTimersByTime(30_000);
    expect(types().filter(t => t === 'stalled')).toHaveLength(3);
    reporter.dispose();
  });

  it('reports a drop, retry and recovery with the gap', () => {
    const { reporter, events } = setup();
    reporter.start('create');
    reporter.onEvent(5);
    reporter.disconnected(new TurnStreamDisconnectedError());
    vi.advanceTimersByTime(500);
    reporter.start('subscribe');
    vi.advanceTimersByTime(300);
    reporter.onEvent(6);
    reporter.completed('done');
    expect(events.map(e => e.type)).toEqual([
      'started',
      'first_event',
      'disconnected',
      'started',
      'reconnected',
      'completed',
    ]);
    expect(events[2]).toMatchObject({ reason: 'closed_without_done', lastSequenceNumber: 5, attempt: 0 });
    expect(events[4]).toMatchObject({ attempt: 1, gapMs: 800 });
    expect(events[5]).toMatchObject({ reconnectCount: 1 });
  });

  it('reports failed after retries and does not also report abandoned', () => {
    const { reporter, types } = setup();
    reporter.start('create');
    reporter.failed(new TypeError('Failed to fetch'));
    reporter.abandon();
    expect(types()).toEqual(['started', 'failed']);
  });

  it('reports abandoned with stalled=true when the client detaches after silence', () => {
    const { reporter, events } = setup();
    reporter.start('create');
    vi.advanceTimersByTime(31_000);
    reporter.abandon();
    reporter.dispose();
    expect(events.at(-1)).toMatchObject({ type: 'abandoned', stalled: true });
  });

  it('stops the watchdog after a terminal event', () => {
    const { reporter, types } = setup();
    reporter.start('create');
    reporter.completed('done');
    vi.advanceTimersByTime(200_000);
    expect(types()).toEqual(['started', 'completed']);
  });

  it('holds create-mode started until the gateway turn id is known', () => {
    const events: TurnStreamLifecycleEvent[] = [];
    let turnId = 'optimistic';
    const reporter = createStreamLifecycleReporter({
      sessionId: 's1',
      getTurnId: () => turnId,
      emit: event => events.push(event),
    });
    reporter.start('create');
    expect(events).toEqual([]);
    turnId = 'gateway';
    reporter.onEvent(1);
    reporter.completed('done');
    expect(events.map(e => [e.type, e.turnId])).toEqual([
      ['started', 'gateway'],
      ['first_event', 'gateway'],
      ['completed', 'gateway'],
    ]);
  });

  it('does not flush create-mode started on stall before the gateway turn id is known', () => {
    const events: TurnStreamLifecycleEvent[] = [];
    let turnId = 'optimistic';
    const reporter = createStreamLifecycleReporter({
      sessionId: 's1',
      getTurnId: () => turnId,
      emit: event => events.push(event),
    });
    reporter.start('create');
    vi.advanceTimersByTime(31_000);
    expect(events).toEqual([]);
    turnId = 'gateway';
    reporter.onEvent(1);
    reporter.completed('done');
    expect(events.map(e => [e.type, e.turnId])).toEqual([
      ['started', 'gateway'],
      ['first_event', 'gateway'],
      ['completed', 'gateway'],
    ]);
    reporter.dispose();
  });

  it('reports a terminal event only once', () => {
    const { reporter, types } = setup();
    reporter.start('subscribe');
    reporter.completed('cancelled');
    reporter.completed('cancelled');
    reporter.failed(new TypeError('Failed to fetch'));
    expect(types()).toEqual(['started', 'completed']);
  });

  it('never throws when the sink throws', () => {
    const reporter = createStreamLifecycleReporter({
      sessionId: 's1',
      getTurnId: () => 't1',
      emit: () => {
        throw new Error('sink down');
      },
    });
    expect(() => {
      reporter.start('create');
      reporter.completed('done');
    }).not.toThrow();
  });
});
