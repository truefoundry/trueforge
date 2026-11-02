import { eventIdSeekCursor, eventIdTimestampMs } from '../../../src/runtime/event-subscription/entryId';
import { eventPayloadMatches } from '../../../src/runtime/event-subscription/repair';

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

  it('matches a durable row when key order or a legacy sequence field differs', () => {
    const event = { id: 'evt-1', type: 'model.message', payload: { index: 1, text: 'hi' } };
    expect(eventPayloadMatches(event, '{"payload":{"text":"hi","index":1},"type":"model.message","id":"evt-1"}')).toBe(
      true,
    );
    expect(
      eventPayloadMatches(
        event,
        '{"id":"evt-1","type":"model.message","payload":{"index":1,"text":"hi"},"sequence_number":4}',
      ),
    ).toBe(true);
    expect(eventPayloadMatches(event, '{"id":"evt-1","type":"model.message","payload":{"index":2,"text":"hi"}}')).toBe(
      false,
    );
  });
});
