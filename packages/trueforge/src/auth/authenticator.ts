import type { Context, MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';

import type { RequestContext } from './identity';

// tells TypeScript that c.set('request_context', …) / c.get('request_context') are valid and return RequestContextt
declare module 'hono' {
  interface ContextVariableMap {
    request_context?: RequestContext;
  }
}

export interface Authenticator {
  authenticate(c: Context): Promise<RequestContext>;
}

export function createAuthMiddleware(authenticator: Authenticator): MiddlewareHandler {
  return async (c, next) => {
    c.set('request_context', await authenticator.authenticate(c));
    return next();
  };
}

export function createAdminAuthMiddleware(authenticator: Authenticator): MiddlewareHandler {
  return async (c, next) => {
    const requestContext = await authenticator.authenticate(c);
    if (!requestContext.is_admin) {
      throw new HTTPException(403, { message: 'Admin access required' });
    }
    c.set('request_context', requestContext);
    return next();
  };
}
