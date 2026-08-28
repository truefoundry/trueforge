import {
  buildSessionMetricsChartData,
  buildSessionMetricsCharts,
  buildSessionMetricsMeters,
  foldSessionMetricsAggregate,
  sessionMetricsStepSeconds,
} from '../../../src/agent-session/store/sessionMetrics';

const emptyAggregate = {
  total_sessions: 0,
  total_turns: 0,
  total_cost_in_usd: 0,
  active_sessions: 0,
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
      created_by: 'user-1',
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
      active_sessions: 3,
      min_turns_per_session: 1,
      max_turns_per_session: 4,
      median_turns_per_session: 2,
      min_session_duration_ms: 100,
      max_session_duration_ms: 1000,
      median_session_duration_ms: 400,
      p95_session_duration_ms: 940,
    });

    expect(metrics.meters).toHaveLength(12);
    expect(metrics.meters.find(meter => meter.name === 'cost_per_session_in_usd')).toEqual({
      name: 'cost_per_session_in_usd',
      aggregate_value: 0.25,
      description: 'Total cost / total sessions',
      unit: '$',
    });
    expect(metrics.meters.find(meter => meter.name === 'avg_turns_per_session')?.aggregate_value).toBe(2.33);
    expect(metrics.meters.find(meter => meter.name === 'p95_session_duration_ms')?.aggregate_value).toBe(940);
  });

  it('maps bucket fields by chart name', () => {
    const query = {
      tenant_id: 'default',
      agent_id: 'agent-1',
      created_by: 'user-1',
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

  it('excludes in-flight sessions from duration distributions', () => {
    const aggregate = foldSessionMetricsAggregate([
      { total_turns: 1, total_duration_ms: 0, total_cost_in_usd: 0 },
      { total_turns: 1, total_duration_ms: 2000, total_cost_in_usd: 0.5 },
    ]);
    expect(aggregate.total_sessions).toBe(2);
    expect(aggregate.active_sessions).toBe(2);
    expect(aggregate.min_turns_per_session).toBe(1);
    expect(aggregate.min_session_duration_ms).toBe(2000);
    expect(aggregate.median_session_duration_ms).toBe(2000);
    expect(aggregate.p95_session_duration_ms).toBe(2000);
  });
});
