/**
 * Shared Kysely SQL expression helpers for SQLite stores.
 * JSON authority: SQLite JSON1 — bind text via jsonb(?); read via json(column).
 * ParseJSONResultsPlugin parses top-level json() columns only (see createSqliteDb).
 */
import { sql, type Expression, type RawBuilder } from 'kysely';

/** Bind a JS value as SQLite JSONB BLOB (stringify in JS, convert in SQL). */
export function jsonbBind(value: unknown): RawBuilder<string> {
  return sql`jsonb(${JSON.stringify(value)})`;
}

/**
 * `jsonb_set(column, path, jsonb(?))`.
 * `path` must be a fixed literal from call sites (e.g. `'$.completion'`).
 */
export function jsonbSet(column: Expression<unknown>, path: string, value: unknown): RawBuilder<string> {
  return sql`jsonb_set(${column}, ${path}, ${jsonbBind(value)})`;
}

/**
 * Project a JSONB column to minified text JSON.
 * With ParseJSONResultsPlugin, the result row field is the parsed JS value typed as `T`.
 */
export function jsonText<T>(column: Expression<unknown>): RawBuilder<T> {
  return sql<T>`json(${column})`;
}

/** Current UTC instant as ISO-8601 text for TEXT timestamp columns. */
export function nowIso(): string {
  return new Date().toISOString();
}

export function isoMsAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString();
}
