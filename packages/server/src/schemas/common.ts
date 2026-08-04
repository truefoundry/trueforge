/**
 * Server-wide shared Zod field schemas and refinements.
 */
import { z } from '@hono/zod-openapi';

/**
 * Lowercase name, 2–64 chars: starts with a letter, ends with alphanumeric,
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
  .describe('Fully qualified name. Unique within a tenant.')
  .openapi('ResourceName');

export type ResourceName = z.infer<typeof NameSchema>;

/** Adds a validation issue if two entries share a name. */
export function uniqueNames(entries: { name: string }[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Duplicate name "${entry.name}" — names must be unique`,
      });
    }
    seen.add(entry.name);
  }
}
