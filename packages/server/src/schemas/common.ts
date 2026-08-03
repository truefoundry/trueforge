/**
 * Server-wide shared Zod field schemas.
 */
import { z } from '@hono/zod-openapi';

/**
 * Lowercase slug, 2–64 chars: starts with a letter, ends with alphanumeric,
 * may contain ".", "_" or "-" in between (aligned with SF model-integration names).
 */
export const NameSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(
    /^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$/,
    'must be 2–64 lowercase chars: start with a letter, end with alphanumeric, optionally separated by ".", "_" or "-"',
  )
  .openapi('ResourceName');

export type ResourceName = z.infer<typeof NameSchema>;
