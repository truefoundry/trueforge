import { OpenAPIHono } from '@hono/zod-openapi';
import { createLogger } from 'winston';
import { createAppErrorHandler } from '../../src/app';

/**
 * Routers throw `HTTPException`; the error envelope and its log line come from the app
 * handler. Mount through this so a router under test answers the way it does in production.
 */
export function mountWithErrorHandler(router: OpenAPIHono): OpenAPIHono {
  const app = new OpenAPIHono();
  app.onError(createAppErrorHandler({ logger: createLogger({ silent: true }) }));
  app.route('/', router);
  return app;
}
