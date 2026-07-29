export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export const KEY_PREFIX = 'rr';

/** Liveness key an executor refreshes; callers check it before publishing. */
export function heartbeatKey(executorId: string): string {
  return `${KEY_PREFIX}:hb:${executorId}`;
}

/** Pub/sub channel: executors subscribe; callers publish the JSON request (see publishedRequestSchema). */
export function requestChannel(executorId: string): string {
  return `${KEY_PREFIX}:req:${executorId}`;
}

/** Per-request key the executor SETs the JSONReply to; the caller polls it with GETDEL. */
export function replyKey(requestId: string): string {
  return `${KEY_PREFIX}:reply:${requestId}`;
}
