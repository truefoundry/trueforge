import {
  StreamGoneError,
  StreamOwnerMismatchError,
  type EventSubscriptionPollOptions,
  type EventSubscriptionRegistry,
  type SequencedEvent,
} from '../../../src/runtime/event-subscription';

/** Payload shape used by the suite; distinct per event so round-trips are provable. */
export interface TestEvent {
  id: string;
  type: string;
  payload: { index: number; text: string };
}

/** Long enough to outlive any test run; also self-cleans Redis keys afterwards. */
const STREAM_TTL_SECONDS = 300;

let streamCounter = 0;
function nextStreamId(): string {
  streamCounter += 1;
  return `eventsub-contract:${String(process.pid)}:${String(Date.now())}:${String(streamCounter)}`;
}

function makeEvent(index: number, id = `evt-${String(index)}`): TestEvent {
  return { id, type: 'test.event', payload: { index, text: `event-${String(index)}` } };
}

/** Drains `count` events from a fresh poll, then aborts it (poll loops forever by design). */
async function collect(
  registry: EventSubscriptionRegistry<TestEvent>,
  streamId: string,
  count: number,
  cursor?: Omit<EventSubscriptionPollOptions, 'signal'>,
): Promise<SequencedEvent<TestEvent>[]> {
  const abort = new AbortController();
  const generator = registry.get(streamId).poll({ signal: abort.signal, ...cursor });
  const received: SequencedEvent<TestEvent>[] = [];
  try {
    for await (const event of generator) {
      received.push(event);
      if (received.length >= count) {
        break;
      }
    }
  } finally {
    abort.abort();
    await generator.return(undefined);
  }
  return received;
}

/** EventSubscription contract suite — factory-injected so both backends run it. */
export function runEventSubscriptionContractSuite(
  setup: () => {
    registry: EventSubscriptionRegistry<TestEvent>;
    /** Drops the log and keeps the owner, the way a TTL expiry does. */
    evictStream: (streamId: string) => Promise<void>;
  },
) {
  it('put appends events in order without a sequence number', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);

    const sent = [makeEvent(0), makeEvent(1), makeEvent(2)];
    for (const event of sent) {
      await producer.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS });
    }
    const received = await collect(registry, streamId, sent.length);
    expect(received).toEqual(sent);
    expect(received.every(event => !Object.hasOwn(event, 'sequence_number'))).toBe(true);
  });

  it('poll from the start yields every event sent, in order, with identical payloads', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);

    const sent = [makeEvent(0), makeEvent(1), makeEvent(2), makeEvent(3), makeEvent(4)];
    for (const event of sent) {
      await producer.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS });
    }

    const received = await collect(registry, streamId, sent.length);
    expect(received).toEqual(sent);
  });

  it('poll with afterSequenceNumber 0 matches an omitted cursor (from the start)', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);

    const sent = [makeEvent(0), makeEvent(1), makeEvent(2)];
    for (const event of sent) {
      await producer.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS });
    }

    const fromOmitted = await collect(registry, streamId, sent.length);
    const fromZero = await collect(registry, streamId, sent.length, { afterSequenceNumber: 0 });
    expect(fromZero).toEqual(fromOmitted);
  });

  it('poll from a mid-stream cursor yields only events strictly after it', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);

    const sent = [0, 1, 2, 3, 4].map(index => makeEvent(index));
    for (const event of sent) {
      await producer.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS });
    }

    const received = await collect(registry, streamId, 3, { afterEventId: 'evt-1' });
    expect(received.map(event => event.id)).toEqual(['evt-2', 'evt-3', 'evt-4']);
  });

  it('keeps an event appended while an event-id replay is delivered', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const sent = [0, 1, 2].map(index => makeEvent(index));
    for (const event of sent) {
      await producer.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS });
    }

    const abort = new AbortController();
    const generator = registry.get(streamId).poll({
      signal: abort.signal,
      afterEventId: 'evt-1',
    });
    try {
      const replayed = await generator.next();
      expect(replayed.value?.id).toBe('evt-2');
      const extra = makeEvent(9, 'evt-extra');
      await producer.put(extra, { streamTTLSeconds: STREAM_TTL_SECONDS });
      const appended = await generator.next();
      expect(appended.value).toEqual(extra);
    } finally {
      abort.abort();
      await generator.return(undefined);
    }
  });

  it('appends a distinct shared-id payload when its timestamp is behind the tail', async () => {
    const { ulid } = await import('ulid');
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const later = makeEvent(0, ulid(2_000_000_000_000).toLowerCase());
    const shell = makeEvent(1, ulid(1_000_000_000_000).toLowerCase());
    const delta = { ...shell, payload: { index: 2, text: 'delta' } };
    await producer.put(later, { streamTTLSeconds: STREAM_TTL_SECONDS });
    await producer.put(shell, { streamTTLSeconds: STREAM_TTL_SECONDS });
    await producer.put(delta, { streamTTLSeconds: STREAM_TTL_SECONDS });

    const received = await collect(registry, streamId, 3);
    expect(received).toEqual([later, shell, delta]);
  });

  it('repairs a suffix when the durable row key order differs from the stream payload', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const stored = makeEvent(0);
    await producer.put(stored, { streamTTLSeconds: STREAM_TTL_SECONDS });
    const fromDatabase = {
      id: 'evt-0',
      type: stored.type,
      payload: { text: stored.payload.text, index: stored.payload.index },
    };
    const third = makeEvent(2);
    await producer.repairLog({
      entries: [
        { id: 'evt-0', event: fromDatabase },
        { id: 'evt-2', event: third },
      ],
      streamTTLSeconds: STREAM_TTL_SECONDS,
    });

    const received = await collect(registry, streamId, 2);
    expect(received.map(event => event.id)).toEqual(['evt-0', 'evt-2']);
  });

  it('poll parked at the tip receives events put after it subscribed', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);

    const first = makeEvent(0);
    await producer.put(first, { streamTTLSeconds: STREAM_TTL_SECONDS });

    const pending = collect(registry, streamId, 2, { afterEventId: 'evt-0' });
    const second = makeEvent(1);
    const third = makeEvent(2);
    await producer.put(second);
    await producer.put(third);

    const received = await pending;
    expect(received).toEqual([second, third]);
  });

  it('rebuilds a missing stream from the event log and continues after the tail', async () => {
    const { registry, evictStream } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const first = makeEvent(1);
    const second = makeEvent(2);
    await producer.put(first, { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'owner' });
    await producer.put(second, { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'owner' });
    await evictStream(streamId);

    await producer.repairLog({
      entries: [
        { id: first.id, event: first },
        { id: second.id, event: second },
      ],
      streamTTLSeconds: STREAM_TTL_SECONDS,
      executorId: 'owner',
    });

    const third = makeEvent(3);
    await producer.put(third, { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'owner' });
    const received = await collect(registry, streamId, 3);
    expect(received).toEqual([first, second, third]);
  });

  it('leaves an existing stream untouched and a second repair does not append again', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const first = makeEvent(1);
    const second = makeEvent(2);
    await producer.put(first, { streamTTLSeconds: STREAM_TTL_SECONDS });
    await producer.put(second, { streamTTLSeconds: STREAM_TTL_SECONDS });
    const repair = () =>
      producer.repairLog({
        entries: [
          { id: first.id, event: first },
          { id: second.id, event: second },
        ],
        streamTTLSeconds: STREAM_TTL_SECONDS,
        executorId: 'owner',
      });
    await repair();
    await repair();

    const third = makeEvent(3);
    await producer.put(third, { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'owner' });
    const received = await collect(registry, streamId, 3);
    expect(received).toEqual([first, second, third]);
  });

  it('rejects a stale producer when the stream is missing', async () => {
    const { registry, evictStream } = setup();
    const streamId = nextStreamId();
    const owner = registry.get(streamId);
    const event = makeEvent(1);
    await owner.repairLog({
      entries: [{ id: event.id, event }],
      streamTTLSeconds: STREAM_TTL_SECONDS,
      executorId: 'owner',
    });
    await evictStream(streamId);

    const stale = registry.get(streamId);
    await expect(
      stale.put(makeEvent(9, 'evt-late'), { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'stale' }),
    ).rejects.toBeInstanceOf(StreamOwnerMismatchError);
    await expect(stale.assertSubscribable()).rejects.toBeInstanceOf(StreamGoneError);
  });

  it('keeps consecutive identical payloads, like two deltas with the same text', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const delta = makeEvent(0, 'evt-message');
    await producer.put(delta, { streamTTLSeconds: STREAM_TTL_SECONDS });
    await producer.put(delta, { streamTTLSeconds: STREAM_TTL_SECONDS });

    const received = await collect(registry, streamId, 2);
    expect(received).toEqual([delta, delta]);
  });

  it('reports whether an event id is on the live stream', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    await producer.put(makeEvent(0), { streamTTLSeconds: STREAM_TTL_SECONDS });
    await producer.put(makeEvent(1), { streamTTLSeconds: STREAM_TTL_SECONDS });

    await expect(producer.hasEventId('evt-1')).resolves.toBe(true);
    await expect(producer.hasEventId('evt-missing')).resolves.toBe(false);
  });
}
