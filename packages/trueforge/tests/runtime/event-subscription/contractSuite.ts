import type { EventSubscriptionRegistry, SequencedEvent } from '../../../src/runtime/event-subscription';

/** Payload shape used by the suite; distinct per event so round-trips are provable. */
export interface TestEvent {
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
): Promise<SequencedEvent<TestEvent>[]> {
  const abort = new AbortController();
  const generator = registry.get(streamId).poll(afterSequenceNumber, { signal: abort.signal });
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
  it('put assigns dense 1-indexed sequence numbers', async () => {
    const registry = createRegistry();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);

    const sequenceNumbers = [];
    for (let i = 0; i < 3; i += 1) {
      sequenceNumbers.push(await producer.put(makeEvent(i), { streamTTLSeconds: STREAM_TTL_SECONDS }));
    }
    expect(sequenceNumbers).toEqual([1, 2, 3]);
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
    expect(received).toEqual(sent.map((event, index) => ({ ...event, sequence_number: index + 1 })));
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
    expect(fromZero[0]?.sequence_number).toBe(1);
  });

  it('poll from a mid-stream cursor yields only events strictly after it', async () => {
    const registry = createRegistry();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);

    const sent = [makeEvent(0), makeEvent(1), makeEvent(2), makeEvent(3), makeEvent(4)];
    for (const event of sent) {
      await producer.put(event, { streamTTLSeconds: STREAM_TTL_SECONDS });
    }

    // after 1 → skip seq 1; replay seq 2, 3, 4
    const received = await collect(registry, streamId, 3, 1);
    expect(received).toEqual([
      { ...sent[1], sequence_number: 2 },
      { ...sent[2], sequence_number: 3 },
      { ...sent[3], sequence_number: 4 },
    ]);
  });

  it('poll parked at the tip receives events put after it subscribed', async () => {
    const registry = createRegistry();
    const streamId = nextStreamId();
    const producer = registry.get(streamId);

    await producer.put(makeEvent(0), { streamTTLSeconds: STREAM_TTL_SECONDS });

    // after 1 (= tip): nothing to replay, so the poller parks for live events.
    const pending = collect(registry, streamId, 2, 1);
    await producer.put(makeEvent(1));
    await producer.put(makeEvent(2));

    const received = await pending;
    expect(received).toEqual([
      { ...makeEvent(1), sequence_number: 2 },
      { ...makeEvent(2), sequence_number: 3 },
    ]);
  });
}
