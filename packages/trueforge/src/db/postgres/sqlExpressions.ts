/**
 * Shared Kysely SQL expression helpers for Postgres stores.
 */
import type { TurnMetricsCheckpoint } from '@truefoundry/trueforge-core/agent-session/schemas/turn';
import { sql, type Expression, type RawBuilder, type SelectQueryBuilder } from 'kysely';
import type { Database, TurnCheckpoint } from './types';

/** Bind a JS value as jsonb (stringified + cast). Required for arrays and for `||` / jsonb_set operands. */
export function json<T>(value: T): RawBuilder<T> {
  return sql`${JSON.stringify(value)}::jsonb`;
}

/** Same as {@link json} for loosely typed import payloads. */
export function jsonUnknown<T>(value: unknown): RawBuilder<T> {
  return sql`${JSON.stringify(value)}::jsonb`;
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

/** Replace the flat turn metrics keys and drop a nested `metrics_checkpoint` from earlier writes. */
export function jsonbSetTurnMetrics(
  target: Expression<unknown>,
  metrics: TurnMetricsCheckpoint,
): RawBuilder<TurnCheckpoint> {
  const withoutNested = sql`${target} - 'metrics_checkpoint'`;
  return jsonbSet<TurnCheckpoint>(
    jsonbSet(
      jsonbSet(withoutNested, sql`'{metrics}'`, json(metrics.metrics)),
      sql`'{active_duration_ms}'`,
      json(metrics.active_duration_ms),
    ),
    sql`'{running_since}'`,
    json(metrics.running_since),
  );
}

/** `now()` timestamptz expression. */
export function now(): RawBuilder<Date> {
  return sql<Date>`now()`;
}

export function nowMinusMs(ms: number): RawBuilder<Date> {
  return sql<Date>`now() - ${ms}::double precision * interval '1 millisecond'`;
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
    return query.where(sql`created_by_subject->>'subject_id'`, '=', filter.created_by_subject_id);
  }
  return query.where(eb =>
    eb.or([
      eb(sql<string>`created_by_subject->>'subject_id'`, '=', filter.created_by_subject_id),
      eb(sql<string>`agent_id`, 'in', [...filter.agent_ids]),
    ]),
  );
}
