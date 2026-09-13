/**
 * Server-wide shared Zod field schemas and refinements.
 */
import { z } from '@hono/zod-openapi';

/**
 * Shared local resource name (agents, skills, MCP, models, schedules).
 * 2–64 lowercase chars, letter start, letter/digit end, hyphens only (matches SVC).
 *
 * - TrueFoundry mode: agent names follow this rule (synced to SVC). Skills/MCP/models
 *   come from SVC as FQNs or longer names and are not checked with NameSchema; AgentSpec
 *   refs stay plain strings. Schedules are local and still use this schema.
 * - Standalone mode: all of those resources are created locally under this schema.
 * - DB migration: rewrites old local names that used `.`/`_` only.
 */
export const NameSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(
    /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/,
    'must be 2–64 lowercase chars: start with a letter, end with alphanumeric, hyphens only in between',
  )
  .openapi('ResourceName');

export type ResourceName = z.infer<typeof NameSchema>;

export const PAGE_LIMIT = 25;
/** Session/turn event list page size (default = max). */
export const EVENTS_PAGE_LIMIT = 100;
/** List-agents page size. */
export const AGENTS_PAGE_DEFAULT = 50;
export const AGENTS_PAGE_LIMIT = 100;

/** Adds a validation issue if two entries share a name. */
export function uniqueNames(entries: { name: string }[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.name)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate name "${entry.name}" — names must be unique`,
      });
    }
    seen.add(entry.name);
  }
}

/** Adds a validation issue if two entries share a type. */
export function uniqueTypes(entries: { type: string }[], ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry.type)) {
      ctx.addIssue({
        code: 'custom',
        message: `Duplicate type "${entry.type}" — types must be unique`,
      });
    }
    seen.add(entry.type);
  }
}

/**
 * Normalize a CSV query value (`?foo=a,b`) into a string list.
 */
export function parseCommaSeparatedQuery(val: unknown): string[] | undefined {
  if (typeof val !== 'string') {
    return undefined;
  }
  return val
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
}
