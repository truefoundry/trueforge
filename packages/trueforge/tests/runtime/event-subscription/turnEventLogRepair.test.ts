import type { TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session/TurnHandle';
import { InMemorySessionStore } from '@truefoundry/trueforge-core/agent-session/store/InMemorySessionStore';
import { TurnOwnershipLostError } from '@truefoundry/trueforge-core/agent-session/store/SessionStoreErrors';
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
import { repairTurnEventLog } from '../../../src/runtime/turnEventLogRepair';

const STREAM_TTL_SECONDS = 300;

async function collect(
  registry: EventSubscriptionRegistry<TurnStreamingEvent>,
  streamId: string,
  count: number,
): Promise<SequencedEvent<TurnStreamingEvent>[]> {
  const abort = new AbortController();
  const generator = registry.get(streamId).poll(undefined, { signal: abort.signal });
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
  it('rebuilds a missing stream from the durable log and keeps the sequence', async () => {
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

    const registry = new EventSubscriptionRegistry<TurnStreamingEvent>(undefined);
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

    await expect(repair('other-executor')).rejects.toBeInstanceOf(TurnOwnershipLostError);
    await expect(subscription.assertSubscribable()).rejects.toBeInstanceOf(StreamGoneError);

    await repair();
    expect(
      (await store.listTurnEventLog({ session_id: sessionId, turn_id: turnId })).map(row => row.sequence_number),
    ).toEqual([null, null]);
    expect((await collect(registry, streamId, 2)).map(event => event.sequence_number)).toEqual([1, 2]);

    await repair();
    expect((await collect(registry, streamId, 2)).map(event => event.sequence_number)).toEqual([1, 2]);

    await repair(TEST_ACTIVE_EXECUTOR_ID);
    expect(
      (await store.listTurnEventLog({ session_id: sessionId, turn_id: turnId })).map(row => row.sequence_number),
    ).toEqual([1, 2]);
    expect((await collect(registry, streamId, 2)).map(event => event.sequence_number)).toEqual([1, 2]);

    const later = makeModelMessageEvent();
    await store.appendToEvents({
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      session_id: sessionId,
      turn_id: turnId,
      events: [later],
    });
    await repair(TEST_ACTIVE_EXECUTOR_ID);
    expect(
      (await store.listTurnEventLog({ session_id: sessionId, turn_id: turnId })).map(row => row.sequence_number),
    ).toEqual([1, 2, 3]);
    expect((await collect(registry, streamId, 3)).map(event => event.sequence_number)).toEqual([1, 2, 3]);

    await registry.evictStream(streamId);
    const stale = registry.get(streamId);
    await expect(
      stale.put(makeModelMessageEvent(), { streamTTLSeconds: STREAM_TTL_SECONDS, executorId: 'other-executor' }),
    ).rejects.toBeInstanceOf(StreamOwnerMismatchError);
    await expect(stale.assertSubscribable()).rejects.toBeInstanceOf(StreamGoneError);

    await repair(TEST_ACTIVE_EXECUTOR_ID);
    const next = await subscription.put(makeModelMessageEvent(), {
      streamTTLSeconds: STREAM_TTL_SECONDS,
      executorId: TEST_ACTIVE_EXECUTOR_ID,
    });
    expect(next).toBe(4);
    expect((await collect(registry, streamId, 4)).map(event => event.sequence_number)).toEqual([1, 2, 3, 4]);
  });
});
