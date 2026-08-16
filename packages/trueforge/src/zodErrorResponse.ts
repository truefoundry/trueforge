/** Shared Zod → HTTP 400 formatting for OpenAPI validation and thrown ZodError. */
import type { Hook } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import type { Context } from 'hono';

export function zodErrorResponse(c: Context, error: z.ZodError) {
  return c.json({ error: { message: z.prettifyError(error) } }, 400);
}

export const zodValidationHook: Hook<unknown, object, string, Response | undefined> = (result, c) => {
  if (!result.success) {
    return zodErrorResponse(c, result.error);
  }
  return undefined;
};
