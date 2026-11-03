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

describe('suffixAfterTail via repairLog', () => {
  it('appends durable rows after a non-durable shared-id stream tip', async () => {
    const { EventSubscriptionRegistry } = await import('../../../src/runtime/event-subscription');
    const registry = new EventSubscriptionRegistry<{ id: string; type: string; payload: { text: string } }>(undefined);
    const streamId = `repair-delta-tip:${String(process.pid)}`;
    const producer = registry.get(streamId);
    const shell = { id: 'evt-1', type: 'model.message', payload: { text: 'shell' } };
    const deltaTip = { id: 'evt-1', type: 'model.message.delta', payload: { text: 'delta' } };
    const next = { id: 'evt-2', type: 'turn.done', payload: { text: 'done' } };
    await producer.put(shell, { streamTTLSeconds: 300 });
    await producer.put(deltaTip, { streamTTLSeconds: 300 });
    await producer.repairLog({
      entries: [
        { id: 'evt-1', event: shell },
        { id: 'evt-2', event: next },
      ],
      streamTTLSeconds: 300,
    });
    const abort = new AbortController();
    const generator = producer.poll({ signal: abort.signal });
    const received: string[] = [];
    try {
      for await (const event of generator) {
        received.push(event.id);
        if (received.length >= 3) {
          break;
        }
      }
    } finally {
      abort.abort();
      await generator.return(undefined);
    }
    expect(received).toEqual(['evt-1', 'evt-1', 'evt-2']);
  });
});
