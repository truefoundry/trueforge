/**
 * Hono leaves OpenAPI deepObject query params flat (`foo[bar]=v`).
 * Fold those keys into a nested map before Zod validation.
 */
import { z } from '@hono/zod-openapi';

function deepObjectQueryIssue({ name, message }: { name: string; message: string }): z.ZodError {
  return new z.ZodError([
    {
      code: 'custom',
      path: [name],
      message,
    },
  ]);
}

function requireSingleString({ name, key, value }: { name: string; key: string; value: unknown }): string {
  if (typeof value === 'string') {
    return value;
  }
  if (Array.isArray(value)) {
    throw deepObjectQueryIssue({ name, message: `Query parameter "${key}" must appear at most once` });
  }
  throw deepObjectQueryIssue({ name, message: `Query parameter "${key}" must be a string` });
}

/** Normalize Hono `queries()` (string | string[]) into a flat record. */
export function honoQueriesToRecord(queries: Record<string, string[]>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, values] of Object.entries(queries)) {
    out[key] = values.length === 1 ? values[0] : values;
  }
  return out;
}

/**
 * Fold Hono's flat deepObject keys for one query param into `{ [name]: { key: value } }`.
 * Passes other keys through unchanged.
 *
 * - `name[key]=value` → map entry
 * - `name[key][…]=…` → rejected (only one bracket level)
 * - bare `name=…` → rejected
 */
export function foldDeepObjectQueryParam({
  query,
  name,
  maxKeys,
}: {
  query: object;
  name: string;
  maxKeys?: number;
}): Record<string, unknown> {
  const equalKey = new RegExp(`^${name}\\[([^\\]]+)\\]$`);
  const nestedBrackets = new RegExp(`^${name}\\[[^\\]]*\\]\\[[^\\]]+\\]`);

  const out: Record<string, unknown> = {};
  const folded: Record<string, string> = {};

  for (const [key, value] of Object.entries(query)) {
    if (key === name) {
      throw deepObjectQueryIssue({
        name,
        message: `Use ${name}[key]=value query parameters; bare ${name} is not supported`,
      });
    }

    if (nestedBrackets.test(key)) {
      throw deepObjectQueryIssue({
        name,
        message: `Nested ${name} query parameters like ${name}[key][…] are not supported; use ${name}[key]=value`,
      });
    }

    const equalMatch = equalKey.exec(key);
    if (equalMatch) {
      const mapKey = equalMatch[1];
      if (mapKey === undefined || mapKey.length === 0) {
        throw deepObjectQueryIssue({ name, message: `${name} filter key must be non-empty` });
      }
      if (Object.hasOwn(folded, mapKey)) {
        throw deepObjectQueryIssue({ name, message: `Duplicate ${name} filter key "${mapKey}"` });
      }
      folded[mapKey] = requireSingleString({ name, key, value });
      continue;
    }

    if (key.startsWith(`${name}[`)) {
      throw deepObjectQueryIssue({ name, message: `Invalid ${name} query parameter "${key}"` });
    }

    out[key] = value;
  }

  const filterKeyCount = Object.keys(folded).length;
  if (maxKeys !== undefined && filterKeyCount > maxKeys) {
    throw deepObjectQueryIssue({ name, message: `at most ${String(maxKeys)} ${name} filter keys` });
  }
  if (filterKeyCount > 0) {
    out[name] = folded;
  }

  return out;
}
