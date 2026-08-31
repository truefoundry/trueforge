/**
 * Session product schemas. Agent binding is a single discriminated `agent`
 * field (`reference` | `inline`). DB stores agent_id / agent_name / agent_spec columns.
 */
import { z } from '@hono/zod-openapi';
import { AgentSpecSchema } from './agentSpec';

export const SessionMetricsSchema = z
  .object({
    total_cost_in_usd: z.number().nonnegative(),
    total_duration_ms: z.number().int().nonnegative(),
    total_turns: z.number().int().nonnegative(),
  })
  .strict()
  .describe('Rolled-up cost, duration, and turn counters for a session.')
  .openapi('SessionMetrics');

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

export const SessionAgentReferenceSchema = z
  .object({
    type: z.literal('reference').describe('Bind the session to a named registry agent.'),
    id: z.string().min(1).describe('Registry agent id.'),
    /** Create-time snapshot of the registry agent name; null for legacy/orphan rows. */
    name: z
      .string()
      .nullable()
      .describe('Create-time snapshot of the registry agent name; null for legacy or orphan rows.'),
  })
  .strict()
  .openapi('SessionAgentReference');

export const SessionAgentInlineSchema = z
  .object({
    type: z.literal('inline').describe('Bind the session to an inline AgentSpec (not a registry id).'),
    spec: AgentSpecSchema,
  })
  .strict()
  .openapi('SessionAgentInline');

/** Named registry binding or inline AgentSpec — exactly one arm. */
export const SessionAgentSchema = z
  .discriminatedUnion('type', [SessionAgentReferenceSchema, SessionAgentInlineSchema])
  .openapi('SessionAgent');

export const SessionSchema = z
  .object({
    id: z.string().describe('Unique session id.'),
    agent: SessionAgentSchema,
    title: z.string().nullable().describe('Optional human-readable title; null until set.'),
    /** Caller identity that created the session (immutable). */
    created_by: z.string().describe('Caller identity that created the session (immutable).'),
    created_at: z.string().describe('ISO 8601 creation timestamp.'),
    updated_at: z.string().describe('ISO 8601 last-update timestamp.'),
    metrics: SessionMetricsSchema,
  })
  .openapi('Session');

export type SessionAgentReference = z.infer<typeof SessionAgentReferenceSchema>;
export type SessionAgentInline = z.infer<typeof SessionAgentInlineSchema>;
export type SessionAgent = z.infer<typeof SessionAgentSchema>;
export type SessionMetrics = z.infer<typeof SessionMetricsSchema>;
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
export type Session = z.infer<typeof SessionSchema>;
