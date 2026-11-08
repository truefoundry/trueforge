import {
  StreamGoneError,
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

/** One durable page per array, in the order given. */
async function* durablePages(...pages: TestEvent[][]): AsyncGenerator<TestEvent[]> {
  await Promise.resolve();
  for (const page of pages) {
    yield page;
  }
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
    /** Drops the log the way a TTL expiry does. */
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

  it('after an event id resumes past the last entry that carries it, even when other events interleave', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const sent = [makeEvent(0, 'evt-a'), makeEvent(1, 'evt-b'), makeEvent(2, 'evt-a'), makeEvent(3, 'evt-c')];
    for (const event of sent) {
      await producer.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS });
    }

    const received = await collect(registry, streamId, 1, { afterEventId: 'evt-a' });
    expect(received.map(event => event.id)).toEqual(['evt-c']);
  });

  it('seeks an event id that sits beyond the first scan batch', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const sent = Array.from({ length: 250 }, (_, index) => makeEvent(index));
    for (const event of sent) {
      await producer.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS });
    }

    await expect(producer.hasEventId('evt-230')).resolves.toBe(true);
    const from = await collect(registry, streamId, 3, { fromEventId: 'evt-230' });
    expect(from.map(event => event.id)).toEqual(['evt-230', 'evt-231', 'evt-232']);
    const after = await collect(registry, streamId, 2, { afterEventId: 'evt-247' });
    expect(after.map(event => event.id)).toEqual(['evt-248', 'evt-249']);
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

  it('restores every page of a missing stream in order', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const sent = Array.from({ length: 5 }, (_, index) => makeEvent(index));

    await registry.get(streamId).restoreLog({
      readPages: () => durablePages(sent.slice(0, 2), [], sent.slice(2)),
      streamTTLSeconds: STREAM_TTL_SECONDS,
    });

    expect(await collect(registry, streamId, sent.length)).toEqual(sent);
  });

  it('keeps a single copy when two restores run together', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const sent = [makeEvent(0), makeEvent(1), makeEvent(2)];
    let reads = 0;
    const restore = () =>
      registry.get(streamId).restoreLog({
        readPages: () => {
          reads += 1;
          return durablePages(sent);
        },
        streamTTLSeconds: STREAM_TTL_SECONDS,
      });
    await Promise.all([restore(), restore()]);
    expect(reads).toBe(1);

    const extra = makeEvent(3);
    await registry.get(streamId).put(extra, { streamTTLSeconds: STREAM_TTL_SECONDS });
    expect(await collect(registry, streamId, sent.length + 1)).toEqual([...sent, extra]);
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
    await producer.put(first, { streamTTLSeconds: STREAM_TTL_SECONDS });
    await producer.put(second, { streamTTLSeconds: STREAM_TTL_SECONDS });
    await evictStream(streamId);
    await expect(producer.assertSubscribable()).rejects.toBeInstanceOf(StreamGoneError);

    await producer.restoreLog({
      readPages: () => durablePages([first, second]),
      streamTTLSeconds: STREAM_TTL_SECONDS,
    });

    const third = makeEvent(3);
    await producer.put(third, { streamTTLSeconds: STREAM_TTL_SECONDS });
    const received = await collect(registry, streamId, 3);
    expect(received).toEqual([first, second, third]);
  });

  it('leaves an existing stream untouched, even when the log has more rows', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const first = makeEvent(1);
    const second = makeEvent(2);
    const durableOnly = makeEvent(3);
    await producer.put(first, { streamTTLSeconds: STREAM_TTL_SECONDS });
    await producer.put(second, { streamTTLSeconds: STREAM_TTL_SECONDS });
    const restore = () =>
      producer.restoreLog({
        readPages: () => durablePages([first, second, durableOnly]),
        streamTTLSeconds: STREAM_TTL_SECONDS,
      });
    await restore();
    await restore();

    const fourth = makeEvent(4);
    await producer.put(fourth, { streamTTLSeconds: STREAM_TTL_SECONDS });
    const received = await collect(registry, streamId, 3);
    expect(received).toEqual([first, second, fourth]);
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

  it('after finds the last copy of an id several batches below the tip', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const shell = makeEvent(0, 'evt-message');
    const delta = { ...shell, payload: { index: 1, text: 'delta' } };
    const later = Array.from({ length: 250 }, (_, index) => makeEvent(index + 2));
    await producer.put(shell, { streamTTLSeconds: STREAM_TTL_SECONDS });
    await producer.put(delta, { streamTTLSeconds: STREAM_TTL_SECONDS });
    for (const event of later) {
      await producer.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS });
    }

    const received = await collect(registry, streamId, later.length, { afterEventId: shell.id });
    expect(received).toEqual(later);
  });

  it('seeks past large payloads', async () => {
    const { registry } = setup();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);
    const large: TestEvent = { id: 'evt-large', type: 'test.event', payload: { index: 0, text: 'x'.repeat(512_000) } };
    const target = makeEvent(1);
    await producer.put(large, { streamTTLSeconds: STREAM_TTL_SECONDS });
    await producer.put(target, { streamTTLSeconds: STREAM_TTL_SECONDS });

    await expect(producer.hasEventId(target.id)).resolves.toBe(true);
    const received = await collect(registry, streamId, 1, { afterEventId: large.id });
    expect(received).toEqual([target]);
  });
}
