import { createClient, type RedisClientType } from 'redis';
import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription';
import { runEventSubscriptionContractSuite, type TestEvent } from './contractSuite';

const REDIS_URL_ENV = 'REDIS_EVENTSUB_TESTS_URL';

const redisUrl = process.env[REDIS_URL_ENV];
const describeRedis = redisUrl !== undefined && redisUrl !== '' ? describe : describe.skip;

describeRedis('RedisEventSubscription (EventSubscription contract)', () => {
  let client: RedisClientType;

  beforeAll(async () => {
    if (redisUrl === undefined) {
      throw new Error(`${REDIS_URL_ENV} must be set when this suite runs`);
    }
    client = createClient({ url: redisUrl });
    await client.connect();
  });

  afterAll(async () => {
    await client.close();
  });

  runEventSubscriptionContractSuite(() => ({
    registry: new EventSubscriptionRegistry<TestEvent>(client),
    evictStream: async streamId => {
      await client.del(streamId);
    },
  }));

  describe('entry format', () => {
    const streamId = `eventsub-format:${String(process.pid)}:${String(Date.now())}`;

    afterEach(async () => {
      await client.del(streamId);
    });

    const event: TestEvent = { id: 'evt-1', type: 'test.event', payload: { index: 1, text: 'one' } };

    it('does not replace a stream that appears before the swap', async () => {
      const registry = new EventSubscriptionRegistry<TestEvent>(client);
      const live: TestEvent = { id: 'evt-live', type: 'test.event', payload: { index: 0, text: 'live' } };
      await registry.get(streamId).put(live, { streamTTLSeconds: 60 });

      await registry.get(streamId).restoreLog({
        readPages: async function* () {
          await Promise.resolve();
          yield [event];
        },
        streamTTLSeconds: 60,
      });

      const entries = await client.xRange(streamId, '-', '+');
      expect(entries.map(entry => entry.message)).toEqual([{ id: 'evt-live', data: JSON.stringify(live) }]);
      expect(await client.keys(`${streamId}:restore:*`)).toEqual([]);
    });

    it('still finds an id in an entry that has no id field', async () => {
      await client.xAdd(streamId, '1-1', {
        data: JSON.stringify({ id: 'evt-old', type: 'test.event', payload: { index: 0, text: 'old' } }),
      });

      const registry = new EventSubscriptionRegistry<TestEvent>(client);
      await expect(registry.get(streamId).hasEventId('evt-old')).resolves.toBe(true);
      await expect(registry.get(streamId).hasEventId('evt-other')).resolves.toBe(false);
    });
  });
});
