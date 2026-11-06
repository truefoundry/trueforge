import { describe, expect, it } from 'vitest';
import {
  createSubscribeReplayProgress,
  resumeCursorCoveringOpenModelMessages,
  subscribeCursorForEvent,
} from '../src/turnStreamUpdate.js';

describe('subscribeCursorForEvent', () => {
  it('starts a model-message resume at an older open shell', () => {
    expect(subscribeCursorForEvent({ type: 'model.message.delta', id: 'm-b' }, 'm-a')).toEqual({
      fromEventId: 'm-a',
    });
    expect(subscribeCursorForEvent({ type: 'model.message.delta', id: 'm-a' }, 'm-b')).toEqual({
      fromEventId: 'm-a',
    });
  });
});

describe('resumeCursorCoveringOpenModelMessages', () => {
  it('pulls a from cursor back to an older open shell and leaves other cursors alone', () => {
    expect(resumeCursorCoveringOpenModelMessages({ fromEventId: 'm-b' }, 'm-a')).toEqual({ fromEventId: 'm-a' });
    expect(resumeCursorCoveringOpenModelMessages({ fromEventId: 'm-a' }, 'm-b')).toEqual({ fromEventId: 'm-a' });
    expect(resumeCursorCoveringOpenModelMessages({ afterEventId: 'pause' }, 'm-a')).toEqual({
      afterEventId: 'pause',
    });
    expect(resumeCursorCoveringOpenModelMessages(undefined, 'm-a')).toBeUndefined();
  });
});

describe('createSubscribeReplayProgress', () => {
  it('does not treat a replay of interleaved cursors as progress', () => {
    const progress = createSubscribeReplayProgress();
    const cursors = [{ fromEventId: 'm-a' }, { fromEventId: 'm-b' }, { fromEventId: 'm-a' }] as const;

    progress.beginAttempt();
    expect(cursors.map(cursor => progress.observe(cursor))).toEqual([true, true, true]);

    progress.beginAttempt();
    expect(cursors.map(cursor => progress.observe(cursor))).toEqual([false, false, false]);
    expect(progress.observe({ fromEventId: 'm-b' })).toBe(true);
  });
});
