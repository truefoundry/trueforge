/** Shared Zod → HTTP 400 formatting for OpenAPI validation and thrown ZodError. */
import type { Hook } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Logger } from 'winston';
import { logRequestError } from './http/requestErrorLog';

export function zodErrorResponse(c: Context, error: z.ZodError) {
  return c.json({ error: { message: z.prettifyError(error) } }, 400);
}

/** Request-validation failures never reach the app error handler, so they log here instead. */
export function createZodValidationHook(logger: Logger): Hook<unknown, object, string, Response | undefined> {
  return (result, c) => {
    if (!result.success) {
      logRequestError({ logger, c, status: 400, error: result.error, message: 'Request validation failed' });
      return zodErrorResponse(c, result.error);
    }
    return undefined;
  };
}
