/**
 * Redis request-reply transport for executor peering: route a command to the
 * replica addressed by a plain `executorId`. Hosts own the Redis connection
 * (inject the node-redis client) and their own id grammar — how an executor
 * id is embedded in / parsed out of resource ids never enters this module.
 */

export { redisRequest } from './client';
export type { SendRequestOptions } from './client';
export { NoResponderError, ReplyError, RequestTimeoutError } from './errors';
export { RequestReplyExecutor } from './executor';
export type { RequestReplyErrorHandler, RunExecutorOptions } from './executor';
export { RequestReplyRouter } from './router';
export type { RouteHandler } from './router';
export { jsonReplySchema } from './types';
export type { JSONReply, JSONValue, RequestEnvelope, RequestHandler } from './types';
