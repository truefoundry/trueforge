/**
 * Shared Kysely SQL expression helpers for SQLite stores.
 * JSON authority: SQLite JSON1 — bind text via jsonb(?); read via json(column).
 * ParseJSONResultsPlugin parses top-level json() columns only (see createSqliteDb).
 */
import { sql, type Expression, type RawBuilder, type SelectQueryBuilder } from 'kysely';
import type { Database } from './types';

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

/** Creator match, or creator OR `agent_id IN agent_ids` when the list is non-empty. */
export function whereCreatedByOrAgentIds<TB extends 'session' | 'schedule', O>(
  query: SelectQueryBuilder<Database, TB, O>,
  filter:
    | {
        created_by_subject_id: string;
        agent_ids: readonly string[];
      }
    | undefined,
): SelectQueryBuilder<Database, TB, O> {
  if (filter === undefined) {
    return query;
  }
  if (filter.agent_ids.length === 0) {
    return query.where(sql`json_extract(created_by_subject, '$.subject_id')`, '=', filter.created_by_subject_id);
  }
  return query.where(eb =>
    eb.or([
      eb(sql<string>`json_extract(created_by_subject, '$.subject_id')`, '=', filter.created_by_subject_id),
      eb(sql<string>`agent_id`, 'in', [...filter.agent_ids]),
    ]),
  );
}
