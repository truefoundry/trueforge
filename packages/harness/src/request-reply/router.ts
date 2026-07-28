import { ReplyError } from './errors';
import type { JSONReply, RequestEnvelope } from './types';

/**
 * Handlers receive the wire body as unvalidated JSON and must validate it
 * themselves (the payload crosses process boundaries).
 */
export type RouteHandler = (request: RequestEnvelope) => Promise<JSONReply>;

/**
 * In-process dispatch table keyed by logical path (e.g. `sessions/cancel`).
 * Unlike the gateway (module singleton), the host creates and wires one.
 */
export class RequestReplyRouter {
  private readonly routes = new Map<string, RouteHandler>();

  /** Boot-time registration: teach the router path → handler. Throws on duplicates. */
  registerRoute(path: string, fn: RouteHandler): void {
    const alreadyAddedFn = this.routes.get(path);
    if (alreadyAddedFn) {
      throw new Error(
        `[RequestReplyRouter] Route ${path} already registered for function ${alreadyAddedFn.name || 'anonymous'}`,
      );
    }
    this.routes.set(path, fn);
  }

  /** Per-message dispatch: called by the executor for each incoming request. */
  async dispatchRoute(path: string, request: RequestEnvelope): Promise<JSONReply> {
    const fn = this.routes.get(path);
    if (!fn) {
      // Gateway throws hono's HTTPException here; ReplyError is the framework-neutral equivalent.
      throw new ReplyError(500, `Route ${path} not found for executor proxying`);
    }
    return fn(request);
  }
}
