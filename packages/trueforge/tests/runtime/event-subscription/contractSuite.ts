import {
  StreamGoneError,
  StreamOwnerMismatchError,
  type EventSubscriptionRegistry,
  type SequencedEvent,
} from '../../../src/runtime/event-subscription';

/** Payload shape used by the suite; distinct per event so round-trips are provable. */
export interface TestEvent {
  id?: string;
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

function makeEvent(index: number): TestEvent {
  return { type: 'test.event', payload: { index, text: `event-${String(index)}` } };
}

/** Drains `count` events from a fresh poll, then aborts it (poll loops forever by design). */
async function collect(
  registry: EventSubscriptionRegistry<TestEvent>,
  streamId: string,
  count: number,
  afterSequenceNumber?: number,
  cursor?: { fromEventId?: string; afterEventId?: string },
): Promise<SequencedEvent<TestEvent>[]> {
  const abort = new AbortController();
  const generator = registry.get(streamId).poll(afterSequenceNumber, { signal: abort.signal, ...cursor });
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
export function runEventSubscriptionContractSuite(createRegistry: () => EventSubscriptionRegistry<TestEvent>) {
  it('put appends events in order without a sequence number', async () => {
    const registry = createRegistry();
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
    const registry = createRegistry();
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
    const registry = createRegistry();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);

    const sent = [makeEvent(0), makeEvent(1), makeEvent(2)];
    for (const event of sent) {
      await producer.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS });
    }

    const fromOmitted = await collect(registry, streamId, sent.length);
    const fromZero = await collect(registry, streamId, sent.length, 0);
    expect(fromZero).toEqual(fromOmitted);
  });

  it('poll from a mid-stream cursor yields only events strictly after it', async () => {
    const registry = createRegistry();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);

    const sent = [0, 1, 2, 3, 4].map(index => ({ id: `evt-${String(index)}`, ...makeEvent(index) }));
    for (const event of sent) {
      await producer.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS });
    }

    const received = await collect(registry, streamId, 3, undefined, { afterEventId: 'evt-1' });
    expect(received.map(event => event.id)).toEqual(['evt-2', 'evt-3', 'evt-4']);
  });

  it('poll parked at the tip receives events put after it subscribed', async () => {
    const registry = createRegistry();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);

    const first = { id: 'evt-0', ...makeEvent(0) };
    await producer.put(first, { streamTTLSeconds: STREAM_TTL_SECONDS });

    const pending = collect(registry, streamId, 2, undefined, { afterEventId: 'evt-0' });
    const second = { id: 'evt-1', ...makeEvent(1) };
    const third = { id: 'evt-2', ...makeEvent(2) };
    await producer.put(second);
    await producer.put(third);

    const received = await pending;
    expect(received).toEqual([second, third]);
  });

  it('rebuilds a missing stream from the event log and continues after the tail', async () => {
    const registry = createRegistry();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const first = { id: 'evt-1', ...makeEvent(0) };
    const second = { id: 'evt-2', ...makeEvent(1) };
    await producer.put(first, { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'owner' });
    await producer.put(second, { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'owner' });
    await registry.evictStream(streamId);

    await producer.repairLog({
      entries: [
        { id: 'evt-1', event: first },
        { id: 'evt-2', event: second },
      ],
      streamTTLSeconds: STREAM_TTL_SECONDS,
      executorId: 'owner',
    });

    const third = { id: 'evt-3', ...makeEvent(2) };
    await producer.put(third, { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'owner' });
    const received = await collect(registry, streamId, 3);
    expect(received).toEqual([first, second, third]);
  });

  it('leaves an existing stream untouched and a second repair does not append again', async () => {
    const registry = createRegistry();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const first = { id: 'evt-1', ...makeEvent(0) };
    const second = { id: 'evt-2', ...makeEvent(1) };
    await producer.put(first, { streamTTLSeconds: STREAM_TTL_SECONDS });
    await producer.put(second, { streamTTLSeconds: STREAM_TTL_SECONDS });
    const repair = () =>
      producer.repairLog({
        entries: [
          { id: 'evt-1', event: first },
          { id: 'evt-2', event: second },
        ],
        streamTTLSeconds: STREAM_TTL_SECONDS,
        executorId: 'owner',
      });
    await repair();
    await repair();

    const third = { id: 'evt-3', ...makeEvent(2) };
    await producer.put(third, { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'owner' });
    const received = await collect(registry, streamId, 3);
    expect(received).toEqual([first, second, third]);
  });

  it('rejects a stale producer when the stream is missing', async () => {
    const registry = createRegistry();
    const streamId = nextStreamId();
    const owner = registry.get(streamId);
    const event = { id: 'evt-1', ...makeEvent(0) };
    await owner.repairLog({
      entries: [{ id: 'evt-1', event }],
      streamTTLSeconds: STREAM_TTL_SECONDS,
      executorId: 'owner',
    });
    await registry.evictStream(streamId);

    const stale = registry.get(streamId);
    await expect(
      stale.put({ id: 'evt-late', ...makeEvent(9) }, { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'stale' }),
    ).rejects.toBeInstanceOf(StreamOwnerMismatchError);
    await expect(stale.assertSubscribable()).rejects.toBeInstanceOf(StreamGoneError);
  });

  it('treats an explicit-id conflict as a no-op when the event id is already the tail', async () => {
    const registry = createRegistry();
    const streamId = nextStreamId();
    const left = registry.get(streamId);
    const right = registry.get(streamId);
    const event = { id: 'evt-same', ...makeEvent(0) };
    await Promise.all([
      left.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS }),
      right.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS }),
    ]);

    const follow = { id: 'evt-next', ...makeEvent(1) };
    await left.put(follow, { streamTTLSeconds: STREAM_TTL_SECONDS });
    const received = await collect(registry, streamId, 2);
    expect(received).toEqual([event, follow]);
  });
}
