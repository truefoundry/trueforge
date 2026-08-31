/**
 * Shared Kysely SQL expression helpers for Postgres stores.
 */
import { sql, type Expression, type RawBuilder } from 'kysely';

function asJsonb<T>(value: unknown): RawBuilder<T> {
  return sql`${JSON.stringify(value)}::jsonb`;
}

/** Bind a JS value as jsonb (stringified + cast). Required for arrays and for `||` / jsonb_set operands. */
export function json<T>(value: T): RawBuilder<T> {
  return asJsonb(value);
}

export function jsonUnknown<T>(value: unknown): RawBuilder<T> {
  return asJsonb(value);
}

/**
 * `jsonb_set(target, path, new_value)`.
 * `path` may be a text[] expression (`sql\`ARRAY['threads', ${id}]\``) or a literal path
 * expression (`sql\`'{sandbox_info}'\`` / `sql\`'{completion}'\``).
 */
export function jsonbSet<T = unknown>(
  target: Expression<unknown>,
  path: Expression<unknown>,
  newValue: Expression<unknown>,
): RawBuilder<T> {
  return sql<T>`jsonb_set(${target}, ${path}, ${newValue})`;
}

/** `now()` timestamptz expression. */
export function now(): RawBuilder<Date> {
  return sql<Date>`now()`;
}

export function nowMinusMs(ms: number): RawBuilder<Date> {
  return sql<Date>`now() - ${ms}::double precision * interval '1 millisecond'`;
}
