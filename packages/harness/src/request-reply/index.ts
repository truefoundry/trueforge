/**
 * Redis request-reply transport for executor peering: route a command to the
 * replica addressed by a plain `executorId`. Hosts own the Redis connection
 * (inject the node-redis client) and their own id grammar — how an executor
 * id is embedded in / parsed out of resource ids never enters this module.
 */

export { DEFAULT_POLL_INTERVAL_MS, DEFAULT_REPLY_TIMEOUT_MS, redisRequest } from './client';
export type { SendRequestOptions } from './client';
export { NoResponderError, ReplyError, RequestTimeoutError } from './errors';
export { DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_REPLY_TTL_MS, RequestReplyExecutor } from './executor';
export type { RequestReplyErrorHandler, RunExecutorOptions } from './executor';
export { RequestReplyRouter } from './router';
export type { RouteHandler } from './router';
export { jsonReplySchema, publishedRequestSchema } from './types';
export type { JSONReply, JSONValue, PublishedRequest, RequestEnvelope, RequestHandler } from './types';
export { heartbeatKey, replyKey, requestChannel } from './utils';
