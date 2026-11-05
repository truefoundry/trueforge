import type { TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session/TurnHandle';
import { InMemorySessionStore } from '@truefoundry/trueforge-core/agent-session/store/InMemorySessionStore';
import {
  makeAgentSpec,
  makeCreateTurnInput,
  makeModelMessageEvent,
  makeTurnCreatedEvent,
  TEST_ACTIVE_EXECUTOR_ID,
} from '../../../../trueforge-core/tests/agent-session/testHelpers';
import {
  EventSubscriptionRegistry,
  StreamGoneError,
  type SequencedEvent,
} from '../../../src/runtime/event-subscription';
import { InMemoryEventStreamStore } from '../../../src/runtime/event-subscription/inMemory';
import { restoreTurnEventLog } from '../../../src/runtime/turnEventLogRestore';

const STREAM_TTL_SECONDS = 300;

async function collect(
  registry: EventSubscriptionRegistry<TurnStreamingEvent>,
  streamId: string,
  count: number,
): Promise<SequencedEvent<TurnStreamingEvent>[]> {
  const abort = new AbortController();
  const generator = registry.get(streamId).poll({ signal: abort.signal });
  const received: SequencedEvent<TurnStreamingEvent>[] = [];
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

describe('restoreTurnEventLog', () => {
  it('rebuilds a missing stream from the whole durable log and never patches an existing one', async () => {
    const store = new InMemorySessionStore();
    const sessionId = 's1';
    const turnId = 'turn-1';
    await store.createSession({
      tenant_id: 't1',
      session_id: sessionId,
      created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
      agent: { type: 'inline', spec: makeAgentSpec() },
      custom: null,
      metadata: {},
      external_id: null,
      source: null,
    });
    await store.createTurn(makeCreateTurnInput({ sessionId, turnId }));
    const created = makeTurnCreatedEvent(turnId);
    const message = makeModelMessageEvent();
    await store.appendToEvents({
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      session_id: sessionId,
      turn_id: turnId,
      events: [created, message],
    });

    const streams = new InMemoryEventStreamStore<TurnStreamingEvent>();
    const registry = new EventSubscriptionRegistry<TurnStreamingEvent>(undefined, streams);
    const streamId = 'turn-stream';
    const subscription = registry.get(streamId);
    const restore = () =>
      restoreTurnEventLog({
        sessionStore: store,
        subscription,
        sessionId,
        turnId,
        streamTTLSeconds: STREAM_TTL_SECONDS,
      });

    await expect(subscription.assertSubscribable()).rejects.toBeInstanceOf(StreamGoneError);

    await restore();
    expect((await collect(registry, streamId, 2)).map(event => event.id)).toEqual([created.id, message.id]);

    await restore();
    expect((await collect(registry, streamId, 2)).map(event => event.id)).toEqual([created.id, message.id]);

    // A durable row the stream lacks is not patched in: only a missing stream is restored.
    const later = makeModelMessageEvent();
    await store.appendToEvents({
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      session_id: sessionId,
      turn_id: turnId,
      events: [later],
    });
    await restore();
    await expect(subscription.hasEventId(later.id)).resolves.toBe(false);

    // Once the stream is gone, the next restore rebuilds it from the whole log.
    streams.evictStream(streamId);
    await expect(subscription.assertSubscribable()).rejects.toBeInstanceOf(StreamGoneError);

    await restore();
    const appended = makeModelMessageEvent();
    await subscription.put(appended, { streamTTLSeconds: STREAM_TTL_SECONDS });
    expect((await collect(registry, streamId, 4)).map(event => event.id)).toEqual([
      created.id,
      message.id,
      later.id,
      appended.id,
    ]);
  });
});
