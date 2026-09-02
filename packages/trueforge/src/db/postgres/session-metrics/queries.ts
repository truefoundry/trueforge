import { sql, type Kysely } from 'kysely';
import type { SessionMetricsChartDataResponse, SessionMetricsMeterResponse } from '../../../schemas/sessionMetrics';
import {
  buildSessionMetricsChartData,
  buildSessionMetricsMeters,
  sessionMetricsStepSeconds,
  type GetSessionMetricsChartDataInput,
  type GetSessionMetricsInput,
  type SessionMetricsAggregate,
  type SessionMetricsBucket,
} from '../../sessionMetricsStore';
import type { Database } from '../types';

async function fetchSessionMetricsAggregate(
  db: Kysely<Database>,
  input: GetSessionMetricsInput,
): Promise<SessionMetricsAggregate> {
  // Every session in the window (including zero-turn / zero-duration); matches foldSessionMetricsAggregate.
  // COALESCE keeps empty windows at 0 (percentile_cont would otherwise be null).
  const aggregateRow = await db
    .selectFrom('session')
    .select([
      sql<number>`COUNT(*)::int`.as('total_sessions'),
      sql<number>`COALESCE(SUM((metrics->>'total_turns')::bigint), 0)::double precision`.as('total_turns'),
      sql<number>`COALESCE(SUM((metrics->>'total_cost_in_usd')::double precision), 0)::double precision`.as(
        'total_cost_in_usd',
      ),
      sql<number>`COALESCE(MIN((metrics->>'total_turns')::bigint), 0)::double precision`.as('min_turns_per_session'),
      sql<number>`COALESCE(MAX((metrics->>'total_turns')::bigint), 0)::double precision`.as('max_turns_per_session'),
      sql<number>`COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY (metrics->>'total_turns')::double precision), 0)::double precision`.as(
        'median_turns_per_session',
      ),
      sql<number>`COALESCE(MIN((metrics->>'total_duration_ms')::bigint), 0)::double precision`.as(
        'min_session_duration_ms',
      ),
      sql<number>`COALESCE(MAX((metrics->>'total_duration_ms')::bigint), 0)::double precision`.as(
        'max_session_duration_ms',
      ),
      sql<number>`COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY (metrics->>'total_duration_ms')::double precision), 0)::double precision`.as(
        'median_session_duration_ms',
      ),
      sql<number>`COALESCE(percentile_cont(0.95) WITHIN GROUP (ORDER BY (metrics->>'total_duration_ms')::double precision), 0)::double precision`.as(
        'p95_session_duration_ms',
      ),
    ])
    .where('tenant_id', '=', input.tenant_id)
    .where('agent_id', '=', input.agent_id)
    .where('created_by', '=', input.created_by)
    .where('created_at', '>=', input.start_timestamp)
    .where('created_at', '<=', input.end_timestamp)
    .executeTakeFirstOrThrow();

  return {
    total_sessions: aggregateRow.total_sessions,
    total_turns: aggregateRow.total_turns,
    total_cost_in_usd: aggregateRow.total_cost_in_usd,
    min_turns_per_session: aggregateRow.min_turns_per_session,
    max_turns_per_session: aggregateRow.max_turns_per_session,
    median_turns_per_session: aggregateRow.median_turns_per_session,
    min_session_duration_ms: aggregateRow.min_session_duration_ms,
    max_session_duration_ms: aggregateRow.max_session_duration_ms,
    median_session_duration_ms: aggregateRow.median_session_duration_ms,
    p95_session_duration_ms: aggregateRow.p95_session_duration_ms,
  };
}

async function fetchSessionMetricsBuckets(
  db: Kysely<Database>,
  input: GetSessionMetricsInput,
  step_seconds: number,
): Promise<SessionMetricsBucket[]> {
  // Sparse buckets only; builders zero-fill missing intervals for the chart line.
  const bucketTimestamp = sql<number>`
    (FLOOR(EXTRACT(EPOCH FROM created_at) / ${step_seconds}) * ${step_seconds})::double precision
  `;
  const bucketRows = await db
    .selectFrom('session')
    .select([
      bucketTimestamp.as('timestamp_seconds'),
      sql<number>`COUNT(*)::int`.as('sessions'),
      sql<number>`COALESCE(SUM((metrics->>'total_turns')::bigint), 0)::double precision`.as('turns'),
      sql<number>`COALESCE(SUM((metrics->>'total_cost_in_usd')::double precision), 0)::double precision`.as('cost'),
    ])
    .where('tenant_id', '=', input.tenant_id)
    .where('agent_id', '=', input.agent_id)
    .where('created_by', '=', input.created_by)
    .where('created_at', '>=', input.start_timestamp)
    .where('created_at', '<=', input.end_timestamp)
    .groupBy(sql`1`)
    .orderBy('timestamp_seconds')
    .execute();

  return bucketRows.map(row => ({
    timestamp_seconds: row.timestamp_seconds,
    sessions: row.sessions,
    turns: row.turns,
    cost: row.cost,
  }));
}

export async function getSessionMetricsMeters(
  db: Kysely<Database>,
  input: GetSessionMetricsInput,
): Promise<SessionMetricsMeterResponse> {
  const aggregate = await fetchSessionMetricsAggregate(db, input);
  return buildSessionMetricsMeters(aggregate);
}

export async function getSessionMetricsChartData(
  db: Kysely<Database>,
  input: GetSessionMetricsChartDataInput,
): Promise<SessionMetricsChartDataResponse> {
  const step_seconds = sessionMetricsStepSeconds(input);
  const buckets = await fetchSessionMetricsBuckets(db, input, step_seconds);
  return buildSessionMetricsChartData({ query: input, buckets, step_seconds });
}
