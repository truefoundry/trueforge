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

export const SessionMetricsMeterSchema = z
  .object({
    name: SessionMetricsMeterNameSchema,
    aggregate_value: z.number().nonnegative(),
    description: z.string(),
    unit: z.enum(['count', '$', 'ms']),
  })
  .strict()
  .openapi('SessionMetricsMeter');

export const SessionMetricsMeterResponseSchema = z
  .object({
    meters: z.array(SessionMetricsMeterSchema).length(12),
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
    charts: z.array(SessionMetricsChartSchema).length(3),
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
    unit: z.enum(['count', '$']),
    chart_type: z.literal('line'),
    graph_lines: z.array(SessionMetricsGraphLineSchema).length(1),
  })
  .strict()
  .openapi('SessionMetricsGraph');

export const SessionMetricsChartDataResponseSchema = z
  .object({
    step: z.string(),
    graphs: z.array(SessionMetricsGraphSchema).length(1),
  })
  .strict()
  .openapi('SessionMetricsChartDataResponse');

export type SessionMetricsPoint = z.infer<typeof SessionMetricsPointSchema>;
export type SessionMetricsMeterName = z.infer<typeof SessionMetricsMeterNameSchema>;
export type SessionMetricsMeter = z.infer<typeof SessionMetricsMeterSchema>;
export type SessionMetricsMeterResponse = z.infer<typeof SessionMetricsMeterResponseSchema>;
export type SessionMetricsChartName = z.infer<typeof SessionMetricsChartNameSchema>;
export type SessionMetricsChart = z.infer<typeof SessionMetricsChartSchema>;
export type SessionMetricsChartResponse = z.infer<typeof SessionMetricsChartResponseSchema>;
export type SessionMetricsGraphLine = z.infer<typeof SessionMetricsGraphLineSchema>;
export type SessionMetricsGraph = z.infer<typeof SessionMetricsGraphSchema>;
export type SessionMetricsChartDataResponse = z.infer<typeof SessionMetricsChartDataResponseSchema>;
