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
  StreamOwnerMismatchError,
  type SequencedEvent,
} from '../../../src/runtime/event-subscription';
import { InMemoryEventStreamStore } from '../../../src/runtime/event-subscription/inMemory';
import { repairTurnEventLog } from '../../../src/runtime/turnEventLogRepair';

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

describe('repairTurnEventLog', () => {
  it('rebuilds a missing stream from the durable log', async () => {
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
    const repair = (producerExecutorId?: string) =>
      repairTurnEventLog({
        sessionStore: store,
        subscription,
        sessionId,
        turnId,
        streamTTLSeconds: STREAM_TTL_SECONDS,
        ...(producerExecutorId === undefined ? {} : { producerExecutorId }),
      });

    await expect(subscription.assertSubscribable()).rejects.toBeInstanceOf(StreamGoneError);

    await repair();
    expect((await collect(registry, streamId, 2)).map(event => event.id)).toEqual([created.id, message.id]);

    await repair();
    expect((await collect(registry, streamId, 2)).map(event => event.id)).toEqual([created.id, message.id]);

    await repair(TEST_ACTIVE_EXECUTOR_ID);

    const later = makeModelMessageEvent();
    await store.appendToEvents({
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      session_id: sessionId,
      turn_id: turnId,
      events: [later],
    });
    await repair(TEST_ACTIVE_EXECUTOR_ID);
    expect((await collect(registry, streamId, 3)).map(event => event.id)).toEqual([created.id, message.id, later.id]);

    streams.evictStream(streamId);
    const stale = registry.get(streamId);
    await expect(
      stale.put(makeModelMessageEvent(), { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'other-executor' }),
    ).rejects.toBeInstanceOf(StreamOwnerMismatchError);
    await expect(stale.assertSubscribable()).rejects.toBeInstanceOf(StreamGoneError);

    await repair(TEST_ACTIVE_EXECUTOR_ID);
    const appended = makeModelMessageEvent();
    await subscription.put(appended, {
      streamTTLSeconds: STREAM_TTL_SECONDS,
      executorId: TEST_ACTIVE_EXECUTOR_ID,
    });
    expect((await collect(registry, streamId, 4)).map(event => event.id)).toEqual([
      created.id,
      message.id,
      later.id,
      appended.id,
    ]);
  });
});
