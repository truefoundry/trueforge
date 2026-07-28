import { ReplyError } from './errors';
import type { JSONReply, RequestEnvelope, RequestHandler } from './types';

/**
 * Handlers receive the wire body as unvalidated JSON and must validate it
 * themselves (the payload crosses process boundaries).
 */
export type RouteHandler = (request: RequestEnvelope) => Promise<JSONReply>;

/**
 * In-process dispatch table keyed by logical path (e.g. `sessions/cancel`).
 * The host creates one at boot and passes `createRequestHandler()` to the
 * executor.
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
      // ReplyError carries an explicit status onto the wire (see executor error mapping).
      throw new ReplyError(500, `Route ${path} not found for executor proxying`);
    }
    return fn(request);
  }

  /** Builds the `requestHandler` callback the executor consumes: it dispatches every incoming request through this router. */
  createRequestHandler(): RequestHandler {
    return (path, request) => this.dispatchRoute(path, request);
  }
}
