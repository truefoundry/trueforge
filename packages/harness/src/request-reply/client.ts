import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { RedisClientType } from 'redis';
import { NoResponderError, RequestTimeoutError } from './errors';
import type { JSONReply, JSONValue, PublishedRequest, RequestEnvelope } from './types';
import { jsonReplySchema } from './types';
import { heartbeatKey, replyKey, requestChannel, sleep } from './utils';

export interface SendRequestOptions {
  /** Max time to wait for a reply after the request is published (ms). */
  replyTimeoutMs: number;
  /** Sleep between poll attempts when the reply is not yet present (ms). */
  pollIntervalMs: number;
}

const DEFAULT_REPLY_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 500;

function resolveSendRequestOptions(options: Partial<SendRequestOptions> | undefined): SendRequestOptions {
  return {
    replyTimeoutMs: options?.replyTimeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS,
    pollIntervalMs: options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
  };
}

function parseReplyPayload(raw: string) {
  const parsed: unknown = JSON.parse(raw);
  return jsonReplySchema.parse(parsed);
}

async function getDelReply(redisClient: RedisClientType, rKey: string): Promise<JSONReply | null> {
  const raw = await redisClient.getDel(rKey);
  if (raw === null) {
    return null;
  }
  return parseReplyPayload(raw);
}

/**
 * Publishes the request (JSON) on the worker channel, then polls the reply key with GETDEL
 * (see https://redis.io/docs/latest/commands/getdel/ ) until a result arrives or the wait
 * budget is exceeded.
 */
export async function redisRequest<T extends JSONValue>({
  redis: redisClient,
  executorId,
  path,
  request,
  options,
}: {
  redis: RedisClientType;
  executorId: string;
  path: string;
  request: RequestEnvelope<T>;
  options?: Partial<SendRequestOptions> | undefined;
}): Promise<JSONReply> {
  const { replyTimeoutMs, pollIntervalMs } = resolveSendRequestOptions(options);
  const aliveK = heartbeatKey(executorId);
  if ((await redisClient.exists(aliveK)) === 0) {
    throw new NoResponderError(executorId);
  }

  const requestId = randomUUID();
  const rKey = replyKey(requestId);
  const payload: PublishedRequest = {
    replyKey: rKey,
    path,
    body: request.body,
    headers: request.headers,
  };
  const serializedPayload = JSON.stringify(payload);
  const subscriberCount = await redisClient.publish(requestChannel(executorId), serializedPayload);
  if (subscriberCount === 0) {
    throw new NoResponderError(executorId, 'No executor received the published request');
  }

  const replyDeadline = performance.now() + replyTimeoutMs;
  // Give the executor a moment to process before the first poll.
  await sleep(Math.min(200, replyTimeoutMs));
  for (;;) {
    const replyPayload = await getDelReply(redisClient, rKey);
    if (replyPayload) {
      return replyPayload;
    }
    if (performance.now() >= replyDeadline) {
      throw new RequestTimeoutError(replyTimeoutMs);
    }
    await sleep(pollIntervalMs);
  }
}
