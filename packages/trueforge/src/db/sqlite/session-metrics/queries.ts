import { sql, type Kysely } from 'kysely';
import type { SessionMetricsChartDataResponse, SessionMetricsMeterResponse } from '../../../schemas/sessionMetrics';
import {
  buildSessionMetricsChartData,
  buildSessionMetricsMeters,
  foldSessionMetricsAggregate,
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
  const start_timestamp = input.start_timestamp.toISOString();
  const end_timestamp = input.end_timestamp.toISOString();
  // Scan rows; fold via foldSessionMetricsAggregate (same as InMemory / Postgres).
  const rows = await db
    .selectFrom('session')
    .select([
      sql<number>`CAST(COALESCE(metrics->>'total_turns', 0) AS INTEGER)`.as('total_turns'),
      sql<number>`CAST(COALESCE(metrics->>'total_duration_ms', 0) AS INTEGER)`.as('total_duration_ms'),
      sql<number>`CAST(COALESCE(metrics->>'total_cost_in_usd', 0) AS REAL)`.as('total_cost_in_usd'),
    ])
    .where('tenant_id', '=', input.tenant_id)
    .where('agent_id', '=', input.agent_id)
    .where(sql`json_extract(created_by_subject, '$.subject_id')`, '=', input.created_by_subject_id)
    .where('created_at', '>=', start_timestamp)
    .where('created_at', '<=', end_timestamp)
    .execute();

  return foldSessionMetricsAggregate(rows);
}

async function fetchSessionMetricsBuckets(
  db: Kysely<Database>,
  input: GetSessionMetricsInput,
  step_seconds: number,
): Promise<SessionMetricsBucket[]> {
  const start_timestamp = input.start_timestamp.toISOString();
  const end_timestamp = input.end_timestamp.toISOString();
  // Sparse buckets only; builders zero-fill missing intervals for the chart line.
  const bucketTimestamp = sql<number>`CAST(unixepoch(created_at) / ${step_seconds} AS INTEGER) * ${step_seconds}`;
  const buckets = await db
    .selectFrom('session')
    .select([
      bucketTimestamp.as('timestamp_seconds'),
      sql<number>`COUNT(*)`.as('sessions'),
      sql<number>`COALESCE(SUM(metrics->>'total_turns'), 0)`.as('turns'),
      sql<number>`COALESCE(SUM(metrics->>'total_cost_in_usd'), 0)`.as('cost'),
    ])
    .where('tenant_id', '=', input.tenant_id)
    .where('agent_id', '=', input.agent_id)
    .where(sql`json_extract(created_by_subject, '$.subject_id')`, '=', input.created_by_subject_id)
    .where('created_at', '>=', start_timestamp)
    .where('created_at', '<=', end_timestamp)
    .groupBy(sql`1`)
    .orderBy('timestamp_seconds')
    .execute();

  return buckets.map(row => ({
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
