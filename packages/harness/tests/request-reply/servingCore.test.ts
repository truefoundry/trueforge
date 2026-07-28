/**
 * Core-focused tests (D12): drive RequestReplyServingCore.handleMessage directly —
 * no subscription involved — against a real Redis. Gated on REDIS_URL like
 * the integration suite.
 */
import { randomUUID } from 'node:crypto';
import { createClient, type RedisClientType } from 'redis';
import winston from 'winston';
import { ReplyError } from '../../src/request-reply/errors';
import { RequestReplyServingCore } from '../../src/request-reply/servingCore';
import { jsonReplySchema, type JSONReply } from '../../src/request-reply/types';
import { heartbeatKey, replyKey, sleep } from '../../src/request-reply/utils';

const REDIS_URL = process.env['REDIS_URL'];
const describeIfRedis = REDIS_URL ? describe : describe.skip;

describeIfRedis('RequestReplyServingCore', () => {
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

  it('writes the handler reply to the reply key with a TTL', async () => {
    const core = new RequestReplyServingCore({
      executorId: `core-${randomUUID().slice(0, 8)}`,
      redis,
      requestHandler: async (path, request) => ({ status: 200, body: { path, echo: request.body } }),
      logger,
    });
    const key = replyKey(`core-test-${randomUUID()}`);

    core.handleMessage(makeMessage({ replyKey: key, path: 'echo', body: { x: 1 } }));

    const reply = await readReply(key);
    expect(reply).toMatchObject({ status: 200, body: { path: 'echo', echo: { x: 1 } } });
    expect(await redis.pTTL(key)).toBeGreaterThan(0);
    await core.drain();
  });

  it('maps a thrown ReplyError to its status and other errors to 500', async () => {
    const core = new RequestReplyServingCore({
      executorId: `core-${randomUUID().slice(0, 8)}`,
      redis,
      requestHandler: async path => {
        if (path === 'precondition') {
          throw new ReplyError(412, 'not running here');
        }
        throw new Error('boom');
      },
      logger,
    });

    const preconditionKey = replyKey(`core-test-${randomUUID()}`);
    core.handleMessage(makeMessage({ replyKey: preconditionKey, path: 'precondition' }));
    expect(await readReply(preconditionKey)).toMatchObject({ status: 412, body: { message: 'not running here' } });

    const errorKey = replyKey(`core-test-${randomUUID()}`);
    core.handleMessage(makeMessage({ replyKey: errorKey, path: 'other' }));
    expect(await readReply(errorKey)).toMatchObject({ status: 500, body: { message: 'boom' } });

    await core.drain();
  });

  it('beats the heartbeat only between startServing and stopServing', async () => {
    const executorId = `core-${randomUUID().slice(0, 8)}`;
    const core = new RequestReplyServingCore({
      executorId,
      redis,
      requestHandler: async () => ({ status: 200, body: {} }),
      logger,
      options: { heartbeatIntervalMs: 200 }, // TTL = 300ms
    });
    const hbKey = heartbeatKey(executorId);

    expect(await redis.exists(hbKey)).toBe(0);

    core.startServing();
    await sleep(100);
    expect(await redis.exists(hbKey)).toBe(1);

    core.stopServing();
    await sleep(500); // past the 300ms TTL with no refresh
    expect(await redis.exists(hbKey)).toBe(0);

    await core.drain();
  });

  it('drain waits for in-flight handlers and then rejects new messages', async () => {
    let handlerFinished = false;
    const core = new RequestReplyServingCore({
      executorId: `core-${randomUUID().slice(0, 8)}`,
      redis,
      requestHandler: async () => {
        await sleep(400);
        handlerFinished = true;
        return { status: 200, body: {} };
      },
      logger,
    });

    const inFlightKey = replyKey(`core-test-${randomUUID()}`);
    core.handleMessage(makeMessage({ replyKey: inFlightKey, path: 'slow' }));
    await core.drain();
    expect(handlerFinished).toBe(true);
    expect(await redis.get(inFlightKey)).not.toBeNull();

    const lateKey = replyKey(`core-test-${randomUUID()}`);
    core.handleMessage(makeMessage({ replyKey: lateKey, path: 'slow' }));
    await sleep(600);
    expect(await redis.get(lateKey)).toBeNull();
  });

  it('drops malformed messages without throwing', async () => {
    const core = new RequestReplyServingCore({
      executorId: `core-${randomUUID().slice(0, 8)}`,
      redis,
      requestHandler: async () => ({ status: 200, body: {} }),
      logger,
    });

    expect(() => {
      core.handleMessage('not-json');
    }).not.toThrow();
    expect(() => {
      core.handleMessage(JSON.stringify({ nope: true }));
    }).not.toThrow();
    await core.drain();
  });
});
