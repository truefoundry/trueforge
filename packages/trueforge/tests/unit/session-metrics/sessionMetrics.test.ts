import {
  buildSessionMetricsChartData,
  buildSessionMetricsCharts,
  buildSessionMetricsMeters,
  foldSessionMetricsAggregate,
  sessionMetricsStepSeconds,
} from '../../../src/db/sessionMetricsStore';

const emptyAggregate = {
  total_sessions: 0,
  total_turns: 0,
  total_cost_in_usd: 0,
  min_turns_per_session: 0,
  max_turns_per_session: 0,
  median_turns_per_session: 0,
  min_session_duration_ms: 0,
  max_session_duration_ms: 0,
  median_session_duration_ms: 0,
  p95_session_duration_ms: 0,
};

describe('session metrics builders', () => {
  it('emits inclusive end bucket for an exact 24h hour-aligned window', () => {
    const query = {
      tenant_id: 'default',
      agent_id: 'agent-1',
      created_by_subject_id: 'user-1',
      start_timestamp: new Date('2026-08-27T00:00:00.000Z'),
      end_timestamp: new Date('2026-08-28T00:00:00.000Z'),
    };
    const step_seconds = sessionMetricsStepSeconds(query);
    const endBucketSeconds = Math.floor(query.end_timestamp.getTime() / 1000 / step_seconds) * step_seconds;
    const chartData = buildSessionMetricsChartData({
      query: { ...query, chart_name: 'sessions_over_time' },
      buckets: [{ timestamp_seconds: endBucketSeconds, sessions: 1, turns: 0, cost: 0 }],
      step_seconds,
    });

    expect(step_seconds).toBe(3600);
    expect(chartData.graphs[0]?.graph_lines[0]?.values).toHaveLength(25);
    expect(chartData.graphs[0]?.graph_lines[0]?.values[0]?.timestamp).toBe('2026-08-27T00:00:00.000Z');
    expect(chartData.graphs[0]?.graph_lines[0]?.values[24]?.timestamp).toBe('2026-08-28T00:00:00.000Z');
    expect(chartData.graphs[0]?.graph_lines[0]?.values[24]?.value).toBe(1);
  });

  it('builds the static chart catalog', () => {
    const charts = buildSessionMetricsCharts();
    expect(charts.charts).toHaveLength(3);
    expect(charts.charts.map(chart => chart.name)).toEqual([
      'sessions_over_time',
      'sessions_cost_over_time',
      'turns_over_time',
    ]);
  });

  it('builds the complete meter list with derived averages', () => {
    const metrics = buildSessionMetricsMeters({
      total_sessions: 4,
      total_turns: 7,
      total_cost_in_usd: 1,
      min_turns_per_session: 0,
      max_turns_per_session: 4,
      median_turns_per_session: 1.5,
      min_session_duration_ms: 0,
      max_session_duration_ms: 1000,
      median_session_duration_ms: 250,
      p95_session_duration_ms: 910,
    });

    expect(metrics.meters).toHaveLength(12);
    expect(metrics.meters.find(meter => meter.name === 'cost_per_session_in_usd')).toEqual({
      name: 'cost_per_session_in_usd',
      aggregate_value: 0.25,
      description: 'Total cost / total sessions',
      unit: '$',
    });
    expect(metrics.meters.find(meter => meter.name === 'avg_turns_per_session')?.aggregate_value).toBe(1.75);
    expect(metrics.meters.find(meter => meter.name === 'p95_session_duration_ms')?.aggregate_value).toBe(910);
  });

  it('maps bucket fields by chart name', () => {
    const query = {
      tenant_id: 'default',
      agent_id: 'agent-1',
      created_by_subject_id: 'user-1',
      start_timestamp: new Date('2026-08-27T00:00:00.000Z'),
      end_timestamp: new Date('2026-08-27T01:00:00.000Z'),
    };
    const startSeconds = Math.floor(query.start_timestamp.getTime() / 1000);
    const buckets = [{ timestamp_seconds: startSeconds, sessions: 2, turns: 3, cost: 1.25 }];

    expect(
      buildSessionMetricsChartData({
        query: { ...query, chart_name: 'sessions_over_time' },
        buckets,
        step_seconds: 3600,
      }).graphs[0]?.graph_lines[0]?.values[0]?.value,
    ).toBe(2);
    expect(
      buildSessionMetricsChartData({
        query: { ...query, chart_name: 'turns_over_time' },
        buckets,
        step_seconds: 3600,
      }).graphs[0]?.graph_lines[0]?.values[0]?.value,
    ).toBe(3);
    expect(
      buildSessionMetricsChartData({
        query: { ...query, chart_name: 'sessions_cost_over_time' },
        buckets,
        step_seconds: 3600,
      }).graphs[0]?.graph_lines[0]?.values[0]?.value,
    ).toBe(1.25);
  });

  it('returns empty meters for an empty aggregate', () => {
    expect(buildSessionMetricsMeters(emptyAggregate).meters).toHaveLength(12);
  });

  it('includes zero-turn and zero-duration sessions in distributions', () => {
    const aggregate = foldSessionMetricsAggregate([
      { total_turns: 0, total_duration_ms: 0, total_cost_in_usd: 0 },
      { total_turns: 1, total_duration_ms: 0, total_cost_in_usd: 0 },
      { total_turns: 1, total_duration_ms: 2000, total_cost_in_usd: 0.5 },
    ]);
    expect(aggregate.total_sessions).toBe(3);
    expect(aggregate.min_turns_per_session).toBe(0);
    expect(aggregate.median_turns_per_session).toBe(1);
    expect(aggregate.min_session_duration_ms).toBe(0);
    expect(aggregate.median_session_duration_ms).toBe(0);
    expect(aggregate.p95_session_duration_ms).toBeCloseTo(1800);
  });
});
