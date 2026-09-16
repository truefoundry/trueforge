import type { RedisClientType, RedisSentinelType } from 'redis';

/** Standalone or Sentinel client for request-reply / command use. */
export type RedisPeerClient = RedisClientType | RedisSentinelType;
