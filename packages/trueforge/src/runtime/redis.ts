/**
 * Primary Redis connection, owned by the server: created and connected at
 * boot, closed last during shutdown. Injected into the request-reply
 * transport (which duplicates it only for its subscriber).
 */
import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';
import { createClient, type RedisClientType } from 'redis';
import type { Logger } from 'winston';

export async function connectRedis(input: { url: string; logger: Logger }): Promise<RedisClientType> {
  const client: RedisClientType = createClient({ url: input.url });
  // Without an 'error' listener node-redis crashes the process on emit;
  // reconnects are automatic, so log and keep running.
  client.on('error', (error: Error) => {
    input.logger.error('[Redis] Client error', extractErrorLogFields(error));
  });
  await client.connect();
  return client;
}
