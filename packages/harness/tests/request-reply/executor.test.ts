/**
 * Executor tests driven through the Subscription hooks contract (D13): a
 * manual Subscription captures the hooks so tests deliver messages and
 * live/lost signals by hand — no subscriber connection — against a real
 * Redis. Gated on REDIS_URL like the integration suite.
 */
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import winston from 'winston';
import { ReplyError } from '../../src/request-reply/errors';
import { RequestReplyExecutor } from '../../src/request-reply/executor';
import type { Subscription, SubscriptionHooks } from '../../src/request-reply/subscription';
import { jsonReplySchema, type JSONReply, type RequestHandler } from '../../src/request-reply/types';
import { heartbeatKey, replyKey, requestChannel, sleep } from '../../src/request-reply/utils';

const REDIS_URL = process.env['REDIS_URL'];
const describeIfRedis = REDIS_URL ? describe : describe.skip;

class ManualSubscription implements Subscription {
  capturedHooks: SubscriptionHooks | null = null;
  closed = false;

  subscribe(hooks: SubscriptionHooks): Promise<void> {
    this.capturedHooks = hooks;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }

  get hooks(): SubscriptionHooks {
    if (!this.capturedHooks) {
      throw new Error('subscribe() was not called');
    }
    return this.capturedHooks;
  }
}

describeIfRedis('RequestReplyExecutor (hooks contract)', () => {
  const logger = winston.createLogger({ silent: true });

  let redis: RedisClientType;

  beforeAll(async () => {
    // describeIfRedis guarantees REDIS_URL is set; narrow it for TS.
    if (!REDIS_URL) {
      throw new Error('REDIS_URL is required for this suite');
    }
    redis = createClient({ url: REDIS_URL });
    await redis.connect();
  });

  afterAll(async () => {
    await redis.close();
  });

  async function makeExecutor(input: {
    requestHandler: RequestHandler;
    heartbeatIntervalMs?: number;
  }): Promise<{ executor: RequestReplyExecutor; subscription: ManualSubscription; executorId: string }> {
    const executorId = `exec-${randomUUID().slice(0, 8)}`;
    const subscription = new ManualSubscription();
    const executor = new RequestReplyExecutor({
      executorId,
      redis,
      requestHandler: input.requestHandler,
      subscription,
      logger,
      ...(input.heartbeatIntervalMs ? { options: { heartbeatIntervalMs: input.heartbeatIntervalMs } } : {}),
    });
    await executor.init();
    return { executor, subscription, executorId };
  }

  function makeMessage(input: { replyKey: string; path: string; body?: unknown }): string {
    return JSON.stringify({ replyKey: input.replyKey, path: input.path, body: input.body ?? {} });
  }

  async function readReply(key: string): Promise<JSONReply> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const raw = await redis.get(key);
      if (raw !== null) {
        return jsonReplySchema.parse(JSON.parse(raw));
      }
      await sleep(50);
    }
    throw new Error(`No reply written to ${key}`);
  }

  it('attaches the subscription with the executor channel and writes replies with a TTL', async () => {
    const { executor, subscription, executorId } = await makeExecutor({
      requestHandler: async (path, request) => ({ status: 200, body: { path, echo: request.body } }),
    });
    expect(subscription.hooks.channel).toBe(requestChannel(executorId));

    const key = replyKey(`exec-test-${randomUUID()}`);
    subscription.hooks.onMessage(makeMessage({ replyKey: key, path: 'echo', body: { x: 1 } }));

    const reply = await readReply(key);
    expect(reply).toMatchObject({ status: 200, body: { path: 'echo', echo: { x: 1 } } });
    expect(await redis.pTTL(key)).toBeGreaterThan(0);
    await executor.drain();
  });

  it('maps a thrown ReplyError to its status and other errors to 500', async () => {
    const { executor, subscription } = await makeExecutor({
      requestHandler: async path => {
        if (path === 'precondition') {
          throw new ReplyError(412, 'not running here');
        }
        throw new Error('boom');
      },
    });

    const preconditionKey = replyKey(`exec-test-${randomUUID()}`);
    subscription.hooks.onMessage(makeMessage({ replyKey: preconditionKey, path: 'precondition' }));
    expect(await readReply(preconditionKey)).toMatchObject({ status: 412, body: { message: 'not running here' } });

    const errorKey = replyKey(`exec-test-${randomUUID()}`);
    subscription.hooks.onMessage(makeMessage({ replyKey: errorKey, path: 'other' }));
    expect(await readReply(errorKey)).toMatchObject({ status: 500, body: { message: 'boom' } });

    await executor.drain();
  });

  it('beats the heartbeat only between onLive and onLost', async () => {
    const { executor, subscription, executorId } = await makeExecutor({
      requestHandler: async () => ({ status: 200, body: {} }),
      heartbeatIntervalMs: 200, // TTL = 300ms
    });
    const hbKey = heartbeatKey(executorId);

    expect(await redis.exists(hbKey)).toBe(0);

    subscription.hooks.onLive();
    await sleep(100);
    expect(await redis.exists(hbKey)).toBe(1);

    subscription.hooks.onLost();
    await sleep(500); // past the 300ms TTL with no refresh
    expect(await redis.exists(hbKey)).toBe(0);

    await executor.drain();
  });

  it('drain closes the subscription, waits for in-flight handlers and rejects new messages', async () => {
    let handlerFinished = false;
    const { executor, subscription } = await makeExecutor({
      requestHandler: async () => {
        await sleep(400);
        handlerFinished = true;
        return { status: 200, body: {} };
      },
    });

    const inFlightKey = replyKey(`exec-test-${randomUUID()}`);
    subscription.hooks.onMessage(makeMessage({ replyKey: inFlightKey, path: 'slow' }));
    await executor.drain();
    expect(subscription.closed).toBe(true);
    expect(handlerFinished).toBe(true);
    expect(await redis.get(inFlightKey)).not.toBeNull();

    const lateKey = replyKey(`exec-test-${randomUUID()}`);
    subscription.hooks.onMessage(makeMessage({ replyKey: lateKey, path: 'slow' }));
    await sleep(600);
    expect(await redis.get(lateKey)).toBeNull();
  });

  it('drops malformed messages without throwing', async () => {
    const { executor, subscription } = await makeExecutor({
      requestHandler: async () => ({ status: 200, body: {} }),
    });

    expect(() => {
      subscription.hooks.onMessage('not-json');
    }).not.toThrow();
    expect(() => {
      subscription.hooks.onMessage(JSON.stringify({ nope: true }));
    }).not.toThrow();
    await executor.drain();
  });

  it('init rejects when subscribe fails and stays unsubscribed, allowing a retry', async () => {
    let attempts = 0;
    const flaky: Subscription = {
      subscribe(hooks) {
        attempts += 1;
        if (attempts === 1) {
          return Promise.reject(new Error('subscribe failed'));
        }
        hooks.onLive();
        return Promise.resolve();
      },
      close() {
        return Promise.resolve();
      },
    };
    const executorId = `exec-${randomUUID().slice(0, 8)}`;
    const executor = new RequestReplyExecutor({
      executorId,
      redis,
      requestHandler: async () => ({ status: 200, body: {} }),
      subscription: flaky,
      logger,
      options: { heartbeatIntervalMs: 200 },
    });

    await expect(executor.init()).rejects.toThrow('subscribe failed');
    expect(attempts).toBe(1);
    expect(await redis.exists(heartbeatKey(executorId))).toBe(0);

    await executor.init();
    expect(attempts).toBe(2);
    await sleep(100);
    expect(await redis.exists(heartbeatKey(executorId))).toBe(1);

    await executor.drain();
  });
});
