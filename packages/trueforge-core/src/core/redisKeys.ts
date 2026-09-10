/**
 * Shared Redis key/channel namespace for TrueForge.
 * Every Redis key and pub/sub channel MUST start with this segment.
 */
export const REDIS_KEY_NAMESPACE = 'tfg' as const;

export function redisKey(...parts: readonly string[]): string {
  return [REDIS_KEY_NAMESPACE, ...parts].join(':');
}
