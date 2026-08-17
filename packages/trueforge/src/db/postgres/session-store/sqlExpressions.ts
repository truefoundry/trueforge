/**
 * Session-store-only helpers for Postgres (VALUES / unnest join shapes).
 * Shared JSON/time helpers live in `../sqlExpressions`.
 */
import { sql, type AliasedRawBuilder, type Expression } from 'kysely';

/**
 * Typed `(VALUES ...) AS alias(col1, col2, ...)` for use in `.selectFrom(...)`.
 * VALUES params are unknown→text unless cast — pass `sql\`${n}::bigint\`` (etc.) for non-text cols.
 * @see https://kysely.dev/docs/recipes/extending-kysely
 */
export function values<R extends object, A extends string>(records: R[], alias: A): AliasedRawBuilder<R, A> {
  const first = records[0];
  if (first === undefined) {
    throw new Error('values() requires at least one record');
  }
  const keys = Object.keys(first) as (keyof R & string)[];

  const valueTuples = sql.join(records.map(r => sql`(${sql.join(keys.map(k => r[k]))})`));

  const wrappedAlias = sql.ref(alias);
  const wrappedColumns = sql.join(keys.map(key => sql.ref(key)));
  const aliasSql = sql`${wrappedAlias}(${wrappedColumns})`;

  return sql<R>`(values ${valueTuples})`.as<A>(aliasSql);
}

/**
 * `unnest(ids::text[]) WITH ORDINALITY AS alias(turn_id, pos)` for `.selectFrom(...)`.
 * Used by listSessionEvents mode-2 (ancestor chain order).
 */
export function unnestWithOrdinality<A extends string>(
  ids: string[],
  alias: A,
): AliasedRawBuilder<{ turn_id: string; pos: number }, A> {
  const wrappedAlias = sql.ref(alias);
  const aliasSql = sql`${wrappedAlias}(turn_id, pos)`;
  return sql<{ turn_id: string; pos: number }>`unnest(${ids}::text[]) WITH ORDINALITY`.as<A>(aliasSql);
}

/**
 * `LATERAL unnest(array_expr) WITH ORDINALITY AS alias(append_id, pos)` for join use.
 * Kysely 0.29 has no leftJoinLateral builder — this expression is the join RHS.
 * Used by getTurn context assembly so empty-context threads still emit a row.
 */
export function lateralUnnestBigintArrayWithOrdinality<A extends string>(
  arrayExpr: Expression<number[] | null>,
  alias: A,
): AliasedRawBuilder<{ append_id: number; pos: number }, A> {
  const wrappedAlias = sql.ref(alias);
  const aliasSql = sql`${wrappedAlias}(append_id, pos)`;
  return sql<{ append_id: number; pos: number }>`LATERAL unnest(${arrayExpr}) WITH ORDINALITY`.as<A>(aliasSql);
}
