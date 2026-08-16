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

  runEventSubscriptionContractSuite(() => new EventSubscriptionRegistry<TestEvent>(client));
});
