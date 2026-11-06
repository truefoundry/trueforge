import type { TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session/TurnHandle';
import { InMemorySessionStore } from '@truefoundry/trueforge-core/agent-session/store/InMemorySessionStore';
import winston from 'winston';
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
const TENANT_ID = 't1';
const SESSION_ID = 's1';
const TURN_ID = 'turn-1';

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

async function createPausedTurnStore(): Promise<InMemorySessionStore> {
  const store = new InMemorySessionStore();
  await store.createSession({
    tenant_id: TENANT_ID,
    session_id: SESSION_ID,
    created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
    agent: { type: 'inline', spec: makeAgentSpec() },
    custom: null,
    metadata: {},
    external_id: null,
    source: null,
  });
  await store.createTurn(makeCreateTurnInput({ sessionId: SESSION_ID, turnId: TURN_ID }));
  return store;
}

/** Collects log records in memory so tests can assert on what a developer would see. */
class RecordingTransport extends winston.Transport {
  readonly records: winston.Logform.TransformableInfo[] = [];

  log(info: winston.Logform.TransformableInfo, next: () => void): void {
    this.records.push(info);
    next();
  }
}

function recordingLogger(): { logger: winston.Logger; records: winston.Logform.TransformableInfo[] } {
  const transport = new RecordingTransport();
  const logger = winston.createLogger({ level: 'debug', transports: [transport] });
  return { logger, records: transport.records };
}

/** Winston writes through a stream; let queued records reach the transport. */
async function flushLogs(): Promise<void> {
  await new Promise(resolve => setImmediate(resolve));
}

describe('restoreTurnEventLog', () => {
  it('rebuilds a missing stream from the whole durable log and never patches an existing one', async () => {
    const store = await createPausedTurnStore();
    const created = makeTurnCreatedEvent(TURN_ID);
    const message = makeModelMessageEvent();
    await store.appendToEvents({
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      session_id: SESSION_ID,
      turn_id: TURN_ID,
      events: [created, message],
    });

    const streams = new InMemoryEventStreamStore<TurnStreamingEvent>();
    const registry = new EventSubscriptionRegistry<TurnStreamingEvent>(undefined, streams);
    const streamId = 'turn-stream';
    const subscription = registry.get(streamId);
    const { logger } = recordingLogger();
    const restore = () =>
      restoreTurnEventLog({
        sessionStore: store,
        subscription,
        logger,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
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
      session_id: SESSION_ID,
      turn_id: TURN_ID,
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

  it('logs the missing stream, one line per page with its query time, and the total duration', async () => {
    const store = await createPausedTurnStore();
    // More rows than one page, so the log shows a second page query.
    const events = [makeTurnCreatedEvent(TURN_ID), ...Array.from({ length: 1_001 }, () => makeModelMessageEvent())];
    await store.appendToEvents({
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      session_id: SESSION_ID,
      turn_id: TURN_ID,
      events,
    });

    const streams = new InMemoryEventStreamStore<TurnStreamingEvent>();
    const registry = new EventSubscriptionRegistry<TurnStreamingEvent>(undefined, streams);
    const subscription = registry.get('turn-stream');
    const { logger, records } = recordingLogger();
    const restore = () =>
      restoreTurnEventLog({
        sessionStore: store,
        subscription,
        logger,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        streamTTLSeconds: STREAM_TTL_SECONDS,
      });

    await restore();
    await flushLogs();
    const rebuilt = records.filter(record => record.message.startsWith('Turn stream'));
    const [missing, firstPage, secondPage, restored] = rebuilt;
    expect(missing?.message).toBe('Turn stream missing, rebuilding from durable log');
    expect(firstPage?.message).toMatch(/^Turn stream restore page 1 queried 1000 rows in \d+(\.\d)?ms, more remain$/);
    expect(secondPage?.message).toMatch(/^Turn stream restore page 2 queried 2 rows in \d+(\.\d)?ms$/);
    expect(restored?.message).toMatch(/^Turn stream restored from durable log \(1002 events, 2 pages, \d+(\.\d)?ms\)$/);
    for (const record of rebuilt) {
      expect(record?.level).toBe('info');
      expect(Object.keys(record ?? {}).sort()).toEqual(['level', 'message']);
    }

    records.length = 0;
    await restore();
    await flushLogs();
    expect(records[0]?.message).toMatch(/^Turn stream present, TTL refreshed in \d+(\.\d)?ms$/);
    expect(records[0]?.level).toBe('debug');
    expect(Object.keys(records[0] ?? {}).sort()).toEqual(['level', 'message']);
  });

  it('logs a lost race when two restores install the same stream', async () => {
    const store = await createPausedTurnStore();
    await store.appendToEvents({
      active_executor_id: TEST_ACTIVE_EXECUTOR_ID,
      session_id: SESSION_ID,
      turn_id: TURN_ID,
      events: [makeTurnCreatedEvent(TURN_ID)],
    });

    const streams = new InMemoryEventStreamStore<TurnStreamingEvent>();
    const registry = new EventSubscriptionRegistry<TurnStreamingEvent>(undefined, streams);
    const subscription = registry.get('turn-stream');
    const { logger, records } = recordingLogger();
    const restore = () =>
      restoreTurnEventLog({
        sessionStore: store,
        subscription,
        logger,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        streamTTLSeconds: STREAM_TTL_SECONDS,
      });

    await Promise.all([restore(), restore()]);
    await flushLogs();
    const outcomes = records.filter(
      record => record.message.includes('restore lost a race') || record.message.includes('restored from durable log'),
    );
    const messages = outcomes.map(record => record.message);
    expect(
      messages.filter(message => /^Turn stream restored from durable log \(1 event, 1 page, /.test(message)),
    ).toHaveLength(1);
    expect(
      messages.filter(message =>
        /^Turn stream restore lost a race to another writer \(1 event, 1 page, /.test(message),
      ),
    ).toHaveLength(1);
    expect(outcomes.every(record => Object.keys(record).sort().join() === 'level,message')).toBe(true);
  });

  it('logs a failed rebuild with its progress and rethrows the error', async () => {
    const failingStore = {
      listTurnEvents: () => Promise.reject(new Error('database unavailable')),
    };
    const streams = new InMemoryEventStreamStore<TurnStreamingEvent>();
    const registry = new EventSubscriptionRegistry<TurnStreamingEvent>(undefined, streams);
    const subscription = registry.get('turn-stream');
    const { logger, records } = recordingLogger();

    await expect(
      restoreTurnEventLog({
        sessionStore: failingStore,
        subscription,
        logger,
        sessionId: SESSION_ID,
        turnId: TURN_ID,
        streamTTLSeconds: STREAM_TTL_SECONDS,
      }),
    ).rejects.toThrow('database unavailable');
    await flushLogs();
    const failure = records.find(record => record.message.startsWith('Turn stream restore failed'));
    expect(failure?.message).toMatch(/^Turn stream restore failed \(0 events, 0 pages, \d+(\.\d)?ms\)$/);
    expect(failure).toMatchObject({
      level: 'warn',
      error: 'database unavailable',
    });
    expect(typeof failure?.['stack']).toBe('string');
    expect(Object.keys(failure ?? {}).sort()).toEqual(['error', 'level', 'message', 'stack']);
  });
});
