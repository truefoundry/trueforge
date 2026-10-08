/** Shared Zod → HTTP 400 formatting for OpenAPI validation and thrown ZodError. */
import type { Hook } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';

export function zodErrorResponse(c: Context, error: z.ZodError) {
  return c.json({ error: { message: z.prettifyError(error) } }, 400);
}

/** Throws so the app error handler owns both the response and its log line. */
export const zodValidationHook: Hook<unknown, object, string, Response | undefined> = result => {
  if (!result.success) {
    throw result.error;
  }
  return undefined;
};
