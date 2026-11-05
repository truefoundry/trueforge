import { eventIdSeekCursor, eventIdTimestampMs } from '../../../src/runtime/event-subscription/entryId';

const EVENT_ID = '01arz3ndektsv4rrffq69g5fav';

describe('event id cursors', () => {
  it('accepts the lowercase ids the server mints', () => {
    expect(eventIdTimestampMs(EVENT_ID)).toBe(eventIdTimestampMs(EVENT_ID.toUpperCase()));
  });

  it('scans a legacy sequence stream from the start', () => {
    expect(eventIdSeekCursor({ eventId: EVENT_ID, firstEntryId: '12-1' })).toBe('0-0');
  });

  it('seeks a ULID-millisecond stream at that millisecond', () => {
    const timestamp = eventIdTimestampMs(EVENT_ID);
    expect(timestamp).toBeDefined();
    if (timestamp === undefined) {
      return;
    }
    expect(eventIdSeekCursor({ eventId: EVENT_ID, firstEntryId: `${String(timestamp)}-0` })).toBe(
      `${String(timestamp - 1)}-18446744073709551615`,
    );
  });
});
