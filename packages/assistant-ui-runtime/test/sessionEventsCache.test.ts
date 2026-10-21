import { describe, expect, it } from 'vitest';
import type { SessionEventItem } from '../src/server/events.js';
import type { Session } from '../src/server/types.js';
import { createSessionEventsCache } from '../src/sessionEventsCache.js';
import { createEmptySessionSnapshot } from '../src/sessionSnapshot.js';

const mockSession: Session = {
  id: 'sess-1',
  title: 'Test Session',
  isMutable: false,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const mockEvent: SessionEventItem = {
  turnId: 't-1',
  event: {
    type: 'turn.created',
    id: 'ev-1',
    turnId: 't-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  },
};

describe('createSessionEventsCache', () => {
  it('stores and retrieves a cached session entry', () => {
    const cache = createSessionEventsCache();
    cache.set('sess-1', {
      session: mockSession,
      events: [mockEvent],
      complete: true,
      fetchedAt: Date.now(),
    });

    expect(cache.get('sess-1')?.events).toEqual([mockEvent]);
    expect(cache.get('sess-1')?.complete).toBe(true);
  });

  it('creates an incomplete entry from a chat snapshot when missing', () => {
    const cache = createSessionEventsCache();
    const snapshot = {
      ...createEmptySessionSnapshot(),
      historyEvents: [mockEvent],
    };
    cache.updateSnapshot('sess-new', snapshot);

    const entry = cache.get('sess-new');
    expect(entry?.snapshot).toEqual(snapshot);
    expect(entry?.complete).toBe(false);
    expect(entry?.events).toEqual([]);
  });

  it('updateSnapshot does not replace events on an existing entry', () => {
    const cache = createSessionEventsCache();
    cache.set('sess-1', {
      session: mockSession,
      events: [mockEvent],
      complete: true,
      fetchedAt: Date.now(),
    });

    const snapshot = {
      ...createEmptySessionSnapshot(),
      historyEvents: [],
    };
    cache.updateSnapshot('sess-1', snapshot);

    expect(cache.get('sess-1')?.events).toEqual([mockEvent]);
    expect(cache.get('sess-1')?.snapshot).toEqual(snapshot);
    expect(cache.get('sess-1')?.complete).toBe(true);
  });

  it('updates cached session metadata', () => {
    const cache = createSessionEventsCache();
    cache.set('sess-1', {
      session: mockSession,
      events: [],
      complete: false,
      fetchedAt: Date.now(),
    });
    cache.updateMetadata('sess-1', { title: 'Renamed Session' });

    expect(cache.get('sess-1')?.session.title).toBe('Renamed Session');
  });

  it('invalidates a cached session', () => {
    const cache = createSessionEventsCache();
    cache.set('sess-1', {
      session: mockSession,
      events: [],
      complete: false,
      fetchedAt: Date.now(),
    });
    cache.invalidate('sess-1');

    expect(cache.get('sess-1')).toBeUndefined();
  });

  it('evicts the oldest entry when reaching max capacity', () => {
    const cache = createSessionEventsCache();
    for (let i = 0; i < 55; i++) {
      cache.set(`sess-${String(i)}`, {
        session: { ...mockSession, id: `sess-${String(i)}` },
        events: [],
        complete: false,
        fetchedAt: Date.now(),
      });
    }

    expect(cache.get('sess-0')).toBeUndefined();
    expect(cache.get('sess-4')).toBeUndefined();
    expect(cache.get('sess-5')).toBeDefined();
    expect(cache.get('sess-54')).toBeDefined();
  });
});
