/**
 * Session metrics dashboard wire schemas (meters/charts).
 * Per-session counters (`SessionMetrics`) stay in trueforge-core.
 */
import { z } from '@hono/zod-openapi';

/** Max inclusive created_at window for session metrics aggregation (30 days). */
export const MAX_SESSION_METRICS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export const SessionMetricsPointSchema = z
  .object({
    timestamp: z.string(),
    value: z.number().nonnegative(),
  })
  .strict()
  .openapi('SessionMetricsPoint');

export const SessionMetricsMeterNameSchema = z.enum([
  'total_sessions',
  'total_cost_in_usd',
  'total_turns',
  'cost_per_session_in_usd',
  'avg_turns_per_session',
  'min_turns_per_session',
  'max_turns_per_session',
  'median_turns_per_session',
  'min_session_duration_ms',
  'max_session_duration_ms',
  'median_session_duration_ms',
  'p95_session_duration_ms',
]);

/** Wire value `$` needs a Fern-safe identifier for SDK codegen. */
const METRICS_USD_FERN_ENUM = {
  $: { name: 'USD' },
} as const;

export const MetricsUnitSchema = z.enum(['count', '$', 'ms']).openapi('MetricsUnit', {
  'x-fern-enum': METRICS_USD_FERN_ENUM,
});

export const SessionMetricsMeterSchema = z
  .object({
    name: SessionMetricsMeterNameSchema,
    aggregate_value: z.number().nonnegative(),
    description: z.string(),
    unit: MetricsUnitSchema,
  })
  .strict()
  .openapi('SessionMetricsMeter');

export const SessionMetricsMeterResponseSchema = z
  .object({
    meters: z.array(SessionMetricsMeterSchema),
  })
  .strict()
  .openapi('SessionMetricsMeterResponse');

export const SessionMetricsChartNameSchema = z
  .enum(['sessions_over_time', 'sessions_cost_over_time', 'turns_over_time'])
  .describe('Session metrics chart to return.')
  .openapi('SessionMetricsChartName');

export const SessionMetricsChartSchema = z
  .object({
    name: SessionMetricsChartNameSchema,
    display_name: z.string(),
    description: z.string(),
    chart_type: z.literal('line'),
  })
  .strict()
  .openapi('SessionMetricsChart');

export const SessionMetricsChartResponseSchema = z
  .object({
    charts: z.array(SessionMetricsChartSchema),
  })
  .strict()
  .openapi('SessionMetricsChartResponse');

export const SessionMetricsGraphLineSchema = z
  .object({
    name: z.string(),
    values: z.array(SessionMetricsPointSchema),
  })
  .strict()
  .openapi('SessionMetricsGraphLine');

export const SessionMetricsGraphSchema = z
  .object({
    name: SessionMetricsChartNameSchema,
    display_name: z.string(),
    description: z.string(),
    unit: MetricsUnitSchema,
    chart_type: z.literal('line'),
    graph_lines: z.array(SessionMetricsGraphLineSchema),
  })
  .strict()
  .openapi('SessionMetricsGraph');

export const SessionMetricsChartDataResponseSchema = z
  .object({
    step: z.string(),
    graphs: z.array(SessionMetricsGraphSchema),
  })
  .strict()
  .openapi('SessionMetricsChartDataResponse');

/** Wire ISO-8601 (RFC 3339, offsets allowed) → Date for metrics window bounds. */
const IsoTimestampQueryParam = z.iso
  .datetime({ offset: true })
  .openapi({ type: 'string', format: 'date-time' })
  .transform(s => new Date(s));

const GetSessionMetricsRequestQueryObjectSchema = z.object({
  agent_id: z.string().min(1).max(64).describe('Named agent identifier.'),
  start_timestamp: IsoTimestampQueryParam.describe('Inclusive lower bound on session `created_at`.'),
  end_timestamp: IsoTimestampQueryParam.describe('Inclusive upper bound on session `created_at`.'),
});

function refineSessionMetricsTimeWindow(
  query: { start_timestamp: Date; end_timestamp: Date },
  ctx: z.RefinementCtx,
): void {
  const windowMs = query.end_timestamp.getTime() - query.start_timestamp.getTime();
  if (windowMs < 0) {
    ctx.addIssue({
      code: 'custom',
      message: 'end_timestamp must be on or after start_timestamp',
      path: ['end_timestamp'],
    });
    return;
  }
  if (windowMs > MAX_SESSION_METRICS_WINDOW_MS) {
    ctx.addIssue({
      code: 'custom',
      message: 'metrics window must not exceed 30 days',
      path: ['end_timestamp'],
    });
  }
}

export const GetSessionMetricsRequestQuerySchema = GetSessionMetricsRequestQueryObjectSchema.superRefine(
  refineSessionMetricsTimeWindow,
).openapi('GetSessionMetricsRequestQuery');

export const GetSessionMetricsChartDataRequestQuerySchema = z
  .object({
    ...GetSessionMetricsRequestQueryObjectSchema.shape,
    chart_name: SessionMetricsChartNameSchema,
  })
  .superRefine(refineSessionMetricsTimeWindow)
  .openapi('GetSessionMetricsChartDataRequestQuery');

export const GetSessionMetricsMeterResponseSchema = z
  .object({
    data: SessionMetricsMeterResponseSchema,
  })
  .openapi('GetSessionMetricsMeterResponse');

export const GetSessionMetricsChartResponseSchema = z
  .object({
    data: SessionMetricsChartResponseSchema,
  })
  .openapi('GetSessionMetricsChartResponse');

export const GetSessionMetricsChartDataResponseSchema = z
  .object({
    data: SessionMetricsChartDataResponseSchema,
  })
  .openapi('GetSessionMetricsChartDataResponse');

export type SessionMetricsPoint = z.infer<typeof SessionMetricsPointSchema>;
export type SessionMetricsMeterName = z.infer<typeof SessionMetricsMeterNameSchema>;
export type MetricsUnit = z.infer<typeof MetricsUnitSchema>;
export type SessionMetricsMeter = z.infer<typeof SessionMetricsMeterSchema>;
export type SessionMetricsMeterResponse = z.infer<typeof SessionMetricsMeterResponseSchema>;
export type SessionMetricsChartName = z.infer<typeof SessionMetricsChartNameSchema>;
export type SessionMetricsChart = z.infer<typeof SessionMetricsChartSchema>;
export type SessionMetricsChartResponse = z.infer<typeof SessionMetricsChartResponseSchema>;
export type SessionMetricsGraphLine = z.infer<typeof SessionMetricsGraphLineSchema>;
export type SessionMetricsGraph = z.infer<typeof SessionMetricsGraphSchema>;
export type SessionMetricsChartDataResponse = z.infer<typeof SessionMetricsChartDataResponseSchema>;
