import type {
  SessionMetricsChartDataResponse,
  SessionMetricsChartName,
  SessionMetricsChartResponse,
  SessionMetricsGraph,
  SessionMetricsMeterResponse,
  SessionMetricsPoint,
} from '../schemas/sessionMetrics';

export interface GetSessionMetricsInput {
  tenant_id: string;
  agent_id: string;
  created_by_subject_id: string | undefined;
  start_timestamp: Date;
  end_timestamp: Date;
}

export interface GetSessionMetricsChartDataInput extends GetSessionMetricsInput {
  chart_name: SessionMetricsChartName;
}

export interface ISessionMetricsStore {
  getSessionMetricsMeters(input: GetSessionMetricsInput): Promise<SessionMetricsMeterResponse>;
  getSessionMetricsChartData(input: GetSessionMetricsChartDataInput): Promise<SessionMetricsChartDataResponse>;
}

/** Hour bucket size when the window is ≤ 24 hours. */
export const SESSION_METRICS_HOUR_STEP_SECONDS = 60 * 60;
/** Day bucket size (86400; matches Monitor/DF daily chart step). */
export const SESSION_METRICS_DAY_STEP_SECONDS = 24 * SESSION_METRICS_HOUR_STEP_SECONDS;

/** Time window used for bucket step selection and zero-fill. */
export interface SessionMetricsTimeWindow {
  start_timestamp: Date;
  end_timestamp: Date;
}

/** Chart-data builder input; store `GetSessionMetricsChartDataInput` is structurally compatible. */
export interface SessionMetricsChartDataBuildInput extends SessionMetricsTimeWindow {
  chart_name: SessionMetricsChartName;
}

export const SESSION_METRICS_CHARTS: SessionMetricsChartResponse['charts'] = [
  {
    name: 'sessions_over_time',
    display_name: 'Sessions',
    description: 'Session starts over time',
    chart_type: 'line',
  },
  {
    name: 'sessions_cost_over_time',
    display_name: 'Cost',
    description: 'Total session cost over time',
    chart_type: 'line',
  },
  {
    name: 'turns_over_time',
    display_name: 'Turns',
    description: 'Total turns over time',
    chart_type: 'line',
  },
];

export interface SessionMetricsAggregate {
  total_sessions: number;
  total_turns: number;
  total_cost_in_usd: number;
  min_turns_per_session: number;
  max_turns_per_session: number;
  median_turns_per_session: number;
  min_session_duration_ms: number;
  max_session_duration_ms: number;
  median_session_duration_ms: number;
  p95_session_duration_ms: number;
}

/** Per-session counters used by {@link foldSessionMetricsAggregate}. */
export interface SessionMetricsRow {
  total_turns: number;
  total_duration_ms: number;
  total_cost_in_usd: number;
}

export interface SessionMetricsBucket {
  timestamp_seconds: number;
  sessions: number;
  turns: number;
  cost: number;
}

/** ≤24h → hourly buckets; longer windows → daily UTC. */
export function sessionMetricsStepSeconds(input: SessionMetricsTimeWindow): number {
  return input.end_timestamp.getTime() - input.start_timestamp.getTime() <= 24 * 60 * 60 * 1000
    ? SESSION_METRICS_HOUR_STEP_SECONDS
    : SESSION_METRICS_DAY_STEP_SECONDS;
}

function round({ value, digits }: { value: number; digits: number }): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** Continuous (linear-interpolated) percentile over a sorted ascending array. */
function continuousPercentile(sortedValues: number[], fraction: number): number {
  if (sortedValues.length === 0) {
    return 0;
  }
  const position = fraction * (sortedValues.length - 1);
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sortedValues[lowerIndex] ?? 0;
  const upper = sortedValues[upperIndex] ?? lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

/**
 * Fold matching sessions into meter inputs. Every session in the window is included
 * (including zero-turn / zero-duration); SQLite / Postgres must match.
 */
export function foldSessionMetricsAggregate(rows: SessionMetricsRow[]): SessionMetricsAggregate {
  const turnsPerSession: number[] = [];
  const sessionDurations: number[] = [];
  let total_turns = 0;
  let total_cost_in_usd = 0;
  for (const row of rows) {
    total_turns += row.total_turns;
    total_cost_in_usd += row.total_cost_in_usd;
    turnsPerSession.push(row.total_turns);
    sessionDurations.push(row.total_duration_ms);
  }
  turnsPerSession.sort((a, b) => a - b);
  sessionDurations.sort((a, b) => a - b);
  return {
    total_sessions: rows.length,
    total_turns,
    total_cost_in_usd,
    min_turns_per_session: turnsPerSession[0] ?? 0,
    max_turns_per_session: turnsPerSession.at(-1) ?? 0,
    median_turns_per_session: continuousPercentile(turnsPerSession, 0.5),
    min_session_duration_ms: sessionDurations[0] ?? 0,
    max_session_duration_ms: sessionDurations.at(-1) ?? 0,
    median_session_duration_ms: continuousPercentile(sessionDurations, 0.5),
    p95_session_duration_ms: continuousPercentile(sessionDurations, 0.95),
  };
}

function buildMeters(aggregate: SessionMetricsAggregate): SessionMetricsMeterResponse['meters'] {
  const costPerSession =
    aggregate.total_sessions === 0
      ? 0
      : round({ value: aggregate.total_cost_in_usd / aggregate.total_sessions, digits: 3 });
  const avgTurnsPerSession =
    aggregate.total_sessions === 0 ? 0 : round({ value: aggregate.total_turns / aggregate.total_sessions, digits: 2 });
  const medianTurns = round({ value: aggregate.median_turns_per_session, digits: 2 });
  const minDuration = Math.round(aggregate.min_session_duration_ms);
  const maxDuration = Math.round(aggregate.max_session_duration_ms);
  const medianDuration = Math.round(aggregate.median_session_duration_ms);
  const p95Duration = Math.round(aggregate.p95_session_duration_ms);

  return [
    {
      name: 'total_sessions',
      aggregate_value: aggregate.total_sessions,
      description: 'Total sessions',
      unit: 'count',
    },
    {
      name: 'total_cost_in_usd',
      aggregate_value: aggregate.total_cost_in_usd,
      description: 'Total cost',
      unit: '$',
    },
    {
      name: 'total_turns',
      aggregate_value: aggregate.total_turns,
      description: 'Total turns',
      unit: 'count',
    },
    {
      name: 'cost_per_session_in_usd',
      aggregate_value: costPerSession,
      description: 'Total cost / total sessions',
      unit: '$',
    },
    {
      name: 'avg_turns_per_session',
      aggregate_value: avgTurnsPerSession,
      description: 'Avg turns / session',
      unit: 'count',
    },
    {
      name: 'min_turns_per_session',
      aggregate_value: aggregate.min_turns_per_session,
      description: 'Min turns',
      unit: 'count',
    },
    {
      name: 'max_turns_per_session',
      aggregate_value: aggregate.max_turns_per_session,
      description: 'Max turns',
      unit: 'count',
    },
    {
      name: 'median_turns_per_session',
      aggregate_value: medianTurns,
      description: 'Median turns',
      unit: 'count',
    },
    {
      name: 'min_session_duration_ms',
      aggregate_value: minDuration,
      description: 'Min duration',
      unit: 'ms',
    },
    {
      name: 'max_session_duration_ms',
      aggregate_value: maxDuration,
      description: 'Max duration',
      unit: 'ms',
    },
    {
      name: 'median_session_duration_ms',
      aggregate_value: medianDuration,
      description: 'Median duration',
      unit: 'ms',
    },
    {
      name: 'p95_session_duration_ms',
      aggregate_value: p95Duration,
      description: 'P95 duration',
      unit: 'ms',
    },
  ];
}

function bucketValue(bucket: SessionMetricsBucket | undefined, chart_name: SessionMetricsChartName): number {
  if (bucket === undefined) {
    return 0;
  }
  switch (chart_name) {
    case 'sessions_over_time':
      return bucket.sessions;
    case 'sessions_cost_over_time':
      return bucket.cost;
    case 'turns_over_time':
      return bucket.turns;
  }
}

function chartSeriesName(chart_name: SessionMetricsChartName): string {
  switch (chart_name) {
    case 'sessions_over_time':
      return 'sessions';
    case 'sessions_cost_over_time':
      return 'cost';
    case 'turns_over_time':
      return 'turns';
  }
}

function chartGraphMeta(
  chart_name: SessionMetricsChartName,
  step_seconds: number,
): Pick<SessionMetricsGraph, 'display_name' | 'description' | 'unit'> {
  const hourly = step_seconds === SESSION_METRICS_HOUR_STEP_SECONDS;
  switch (chart_name) {
    case 'sessions_over_time':
      return {
        display_name: hourly ? 'Sessions per hour' : 'Sessions per day',
        description: hourly ? 'How many sessions started each hour' : 'How many sessions started each day',
        unit: 'count',
      };
    case 'sessions_cost_over_time':
      return {
        display_name: hourly ? 'Cost per hour' : 'Cost per day',
        description: hourly ? 'Total session cost each hour' : 'Total session cost each day',
        unit: '$',
      };
    case 'turns_over_time':
      return {
        display_name: hourly ? 'Turns per hour' : 'Turns per day',
        description: hourly ? 'Total turns each hour' : 'Total turns each day',
        unit: 'count',
      };
  }
}

function buildChartValues(input: {
  query: SessionMetricsChartDataBuildInput;
  buckets: SessionMetricsBucket[];
  step_seconds: number;
}): SessionMetricsPoint[] {
  const byTimestamp = new Map(input.buckets.map(bucket => [bucket.timestamp_seconds, bucket]));
  const values: SessionMetricsPoint[] = [];
  const firstTimestampSeconds =
    Math.floor(input.query.start_timestamp.getTime() / 1000 / input.step_seconds) * input.step_seconds;

  for (
    let timestampSeconds = firstTimestampSeconds;
    // Inclusive end matches meters / SQL (`created_at <= end_timestamp`).
    timestampSeconds * 1000 <= input.query.end_timestamp.getTime();
    timestampSeconds += input.step_seconds
  ) {
    const bucket = byTimestamp.get(timestampSeconds);
    values.push({
      timestamp: new Date(timestampSeconds * 1000).toISOString(),
      value: bucketValue(bucket, input.query.chart_name),
    });
  }

  return values;
}

export function buildSessionMetricsMeters(aggregate: SessionMetricsAggregate): SessionMetricsMeterResponse {
  return { meters: buildMeters(aggregate) };
}

export function buildSessionMetricsCharts(): SessionMetricsChartResponse {
  return { charts: SESSION_METRICS_CHARTS };
}

export function buildSessionMetricsChartData(input: {
  query: SessionMetricsChartDataBuildInput;
  buckets: SessionMetricsBucket[];
  step_seconds: number;
}): SessionMetricsChartDataResponse {
  const meta = chartGraphMeta(input.query.chart_name, input.step_seconds);
  return {
    step: String(input.step_seconds),
    graphs: [
      {
        name: input.query.chart_name,
        display_name: meta.display_name,
        description: meta.description,
        unit: meta.unit,
        chart_type: 'line',
        graph_lines: [
          {
            name: chartSeriesName(input.query.chart_name),
            values: buildChartValues(input),
          },
        ],
      },
    ],
  };
}
