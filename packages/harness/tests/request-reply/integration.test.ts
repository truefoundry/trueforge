/**
 * Round-trip tests against a real Redis. Gated on REDIS_URL so CI without a
 * Redis service skips them:
 *
 *   REDIS_URL=redis://localhost:6379 pnpm --filter @truefoundry/utils test
 */
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import winston from 'winston';
import { redisRequest } from '../../src/request-reply/client';
import { NoResponderError, RequestTimeoutError } from '../../src/request-reply/errors';
import { RequestReplyExecutor } from '../../src/request-reply/executor';
import { RequestReplyRouter } from '../../src/request-reply/router';
import type { Subscription } from '../../src/request-reply/subscription';
import { heartbeatKey, sleep } from '../../src/request-reply/utils';

const REDIS_URL = process.env['REDIS_URL'];
const describeIfRedis = REDIS_URL ? describe : describe.skip;

/**
 * Test copy of the host-owned standalone strategy (the package ships only the
 * Subscription contract; packages/server owns the production implementation).
 */
function testStandaloneSubscription(redis: RedisClientType): Subscription {
  let subscriber: RedisClientType | null = null;
  let subscribedChannel: string | null = null;
  return {
    async subscribe({ channel, onMessage, onLive, onLost }) {
      subscribedChannel = channel;
      subscriber = redis.duplicate();
      subscriber.on('error', () => {
        onLost();
      });
      await subscriber.connect();
      await subscriber.subscribe(channel, onMessage);
      onLive();
    },
    async close() {
      if (!subscriber) {
        return;
      }
      if (subscribedChannel) {
        await subscriber.unsubscribe(subscribedChannel).catch(() => undefined);
      }
      await subscriber.close().catch(() => undefined);
      subscriber = null;
    },
  };
}

describeIfRedis('request-reply over Redis', () => {
  const logger = winston.createLogger({ silent: true });
  const executorIdA = `rrtest-a-${randomUUID().slice(0, 8)}`;
  const executorIdB = `rrtest-b-${randomUUID().slice(0, 8)}`;

  let redis: RedisClientType;
  let executorA: RequestReplyExecutor;
  let executorB: RequestReplyExecutor;

  /** The first heartbeat SET is fired without being awaited; poll until it lands. */
  async function waitForHeartbeat(executorId: string): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      if ((await redis.exists(heartbeatKey(executorId))) === 1) {
        return;
      }
      await sleep(100);
    }
    throw new Error(`Executor ${executorId} never became ready`);
  }

  beforeAll(async () => {
    // describeIfRedis guarantees REDIS_URL is set; narrow it for TS.
    if (!REDIS_URL) {
      throw new Error('REDIS_URL is required for this suite');
    }
    redis = createClient({ url: REDIS_URL });
    await redis.connect();

    const routerA = new RequestReplyRouter();
    routerA.registerRoute('whoami', async () => ({ status: 200, body: { executor: 'A' } }));
    routerA.registerRoute('slow', async () => {
      await sleep(2_000);
      return { status: 200, body: {} };
    });
    executorA = new RequestReplyExecutor({
      executorId: executorIdA,
      redis,
      requestHandler: routerA.createRequestHandler(),
      subscription: testStandaloneSubscription(redis),
      logger,
      options: { heartbeatIntervalMs: 500 },
    });
    await executorA.init();

    const routerB = new RequestReplyRouter();
    routerB.registerRoute('whoami', async () => ({ status: 200, body: { executor: 'B' } }));
    executorB = new RequestReplyExecutor({
      executorId: executorIdB,
      redis,
      requestHandler: routerB.createRequestHandler(),
      subscription: testStandaloneSubscription(redis),
      logger,
      options: { heartbeatIntervalMs: 500 },
    });
    await executorB.init();

    await waitForHeartbeat(executorIdA);
    await waitForHeartbeat(executorIdB);
  });

  afterAll(async () => {
    await executorA.drain();
    await executorB.drain();
    await redis.close();
  });

  it('routes each request to the executor named by the id', async () => {
    const replyA = await redisRequest({ redis, executorId: executorIdA, path: 'whoami', request: { body: {} } });
    expect(replyA).toMatchObject({ status: 200, body: { executor: 'A' } });

    const replyB = await redisRequest({ redis, executorId: executorIdB, path: 'whoami', request: { body: {} } });
    expect(replyB).toMatchObject({ status: 200, body: { executor: 'B' } });
  });

  it('replies 500 for a path the executor does not serve', async () => {
    const reply = await redisRequest({ redis, executorId: executorIdB, path: 'slow', request: { body: {} } });
    expect(reply.status).toBe(500);
  });

  it('throws NoResponderError when the executor has no heartbeat', async () => {
    await expect(
      redisRequest({ redis, executorId: 'rrtest-missing', path: 'whoami', request: { body: {} } }),
    ).rejects.toThrow(NoResponderError);
  });

  it('throws RequestTimeoutError when the reply does not arrive in time', async () => {
    await expect(
      redisRequest({
        redis,
        executorId: executorIdA,
        path: 'slow',
        request: { body: {} },
        options: { replyTimeoutMs: 400, pollIntervalMs: 50 },
      }),
    ).rejects.toThrow(RequestTimeoutError);
  });
});
