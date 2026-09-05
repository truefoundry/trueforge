import type { ISessionStore } from '@truefoundry/trueforge-core/agent-session';
import {
  makeCreateTurnInput,
  makeDoneTurnState,
  makeTurnDoneEvent,
} from '../../../../trueforge-core/tests/agent-session/testHelpers';
import type { ISessionMetricsStore } from '../../../src/db/sessionMetricsStore';

function mustGet<T>(value: T | undefined | null, label = 'value'): T {
  if (value === undefined || value === null) {
    throw new Error(`Expected ${label} to be defined`);
  }
  return value;
}

/** Shared meters/charts contract for Postgres / SQLite metrics stores. */
export function runSessionMetricsStoreContractSuite(
  createStores: () => {
    sessionStore: ISessionStore;
    metricsStore: ISessionMetricsStore;
  },
) {
  const tenant = 't1';

  describe('session metrics store', () => {
    it('aggregates caller-owned named sessions and zero-fills hourly series', async () => {
      const { sessionStore, metricsStore } = createStores();
      const start = new Date(Date.now() - 60 * 60 * 1000);
      await sessionStore.createSession({
        tenant_id: tenant,
        session_id: 'metrics-session',
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'reference', id: 'agent-abc', name: 'Agent ABC' },
        custom: null,
        metadata: {},
        external_id: null,
        source: null,
      });
      await sessionStore.createSession({
        tenant_id: tenant,
        session_id: 'other-user-metrics-session',
        created_by_subject: { subject_id: 'user-2', subject_type: 'user', subject_display_name: 'user-2' },
        agent: { type: 'reference', id: 'agent-abc', name: 'Agent ABC' },
        custom: null,
        metadata: {},
        external_id: null,
        source: null,
      });
      await sessionStore.createTurn(makeCreateTurnInput({ sessionId: 'metrics-session', turnId: 'metrics-turn' }));
      const turn = mustGet(await sessionStore.getTurn({ session_id: 'metrics-session', turn_id: 'metrics-turn' }));
      const state = {
        ...makeDoneTurnState(),
        completed_at: new Date(turn.created_at.getTime() + 1500).toISOString(),
        metrics: { total_cost_in_usd: 1.25 },
      };
      await sessionStore.updateTurnState({
        session_id: 'metrics-session',
        turn_id: 'metrics-turn',
        state,
        turn_done_event: makeTurnDoneEvent(state),
      });

      const metricsQuery = {
        tenant_id: tenant,
        agent_id: 'agent-abc',
        created_by_subject_id: 'user-1',
        start_timestamp: start,
        end_timestamp: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      };
      const meters = await metricsStore.getSessionMetricsMeters(metricsQuery);
      const sessionsChart = await metricsStore.getSessionMetricsChartData({
        ...metricsQuery,
        chart_name: 'sessions_over_time',
      });
      const turnsChart = await metricsStore.getSessionMetricsChartData({
        ...metricsQuery,
        chart_name: 'turns_over_time',
      });
      const costChart = await metricsStore.getSessionMetricsChartData({
        ...metricsQuery,
        chart_name: 'sessions_cost_over_time',
      });

      expect(sessionsChart.step).toBe('3600');
      expect(meters.meters).toHaveLength(12);
      expect(meters.meters.find(meter => meter.name === 'total_sessions')?.aggregate_value).toBe(1);
      expect(meters.meters.find(meter => meter.name === 'total_turns')?.aggregate_value).toBe(1);
      expect(meters.meters.find(meter => meter.name === 'total_cost_in_usd')?.aggregate_value).toBe(1.25);
      expect(meters.meters.find(meter => meter.name === 'avg_turns_per_session')?.aggregate_value).toBe(1);
      expect(meters.meters.find(meter => meter.name === 'min_turns_per_session')?.aggregate_value).toBe(1);
      expect(meters.meters.find(meter => meter.name === 'max_turns_per_session')?.aggregate_value).toBe(1);
      expect(meters.meters.find(meter => meter.name === 'median_turns_per_session')?.aggregate_value).toBe(1);
      expect(meters.meters.find(meter => meter.name === 'min_session_duration_ms')?.aggregate_value).toBe(1500);
      expect(meters.meters.find(meter => meter.name === 'max_session_duration_ms')?.aggregate_value).toBe(1500);
      expect(meters.meters.find(meter => meter.name === 'median_session_duration_ms')?.aggregate_value).toBe(1500);
      expect(meters.meters.find(meter => meter.name === 'p95_session_duration_ms')?.aggregate_value).toBe(1500);
      expect(sessionsChart.graphs[0]?.graph_lines[0]?.values.reduce((sum, point) => sum + point.value, 0)).toBe(1);
      expect(turnsChart.graphs[0]?.graph_lines[0]?.values.reduce((sum, point) => sum + point.value, 0)).toBe(1);
      expect(costChart.graphs[0]?.graph_lines[0]?.values.reduce((sum, point) => sum + point.value, 0)).toBe(1.25);
      expect(sessionsChart.graphs[0]?.graph_lines[0]?.values.some(point => point.value === 0)).toBe(true);

      const dailyChart = await metricsStore.getSessionMetricsChartData({
        ...metricsQuery,
        start_timestamp: new Date(start.getTime() - 24 * 60 * 60 * 1000),
        end_timestamp: new Date(start.getTime() + 24 * 60 * 60 * 1000),
        chart_name: 'sessions_over_time',
      });
      expect(dailyChart.step).toBe('86400');
    });

    it('calculates session distributions with continuous percentiles', async () => {
      const { sessionStore, metricsStore } = createStores();
      const sessionDefinitions = [
        { id: 'metrics-inactive', turnDurations: [] as number[] },
        { id: 'metrics-one-turn', turnDurations: [100] },
        { id: 'metrics-two-turns', turnDurations: [200, 200] },
        { id: 'metrics-four-turns', turnDurations: [250, 250, 250, 250] },
      ];
      for (const definition of sessionDefinitions) {
        await sessionStore.createSession({
          tenant_id: tenant,
          session_id: definition.id,
          created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
          agent: { type: 'reference', id: 'agent-distributions', name: 'Agent Distributions' },
          custom: null,
          metadata: {},
          external_id: null,
          source: null,
        });
        for (const [index, durationMs] of definition.turnDurations.entries()) {
          const turnId = `${definition.id}-turn-${String(index)}`;
          await sessionStore.createTurn(makeCreateTurnInput({ sessionId: definition.id, turnId }));
          const turn = mustGet(await sessionStore.getTurn({ session_id: definition.id, turn_id: turnId }));
          const state = {
            ...makeDoneTurnState(),
            completed_at: new Date(turn.created_at.getTime() + durationMs).toISOString(),
          };
          await sessionStore.updateTurnState({
            session_id: definition.id,
            turn_id: turnId,
            state,
            turn_done_event: makeTurnDoneEvent(state),
          });
        }
      }

      const meters = await metricsStore.getSessionMetricsMeters({
        tenant_id: tenant,
        agent_id: 'agent-distributions',
        created_by_subject_id: 'user-1',
        start_timestamp: new Date(Date.now() - 60 * 60 * 1000),
        end_timestamp: new Date(Date.now() + 60 * 60 * 1000),
      });

      // Includes zero-turn / zero-duration session: turns [0,1,2,4], durations [0,100,400,1000].
      expect(meters.meters.find(meter => meter.name === 'total_sessions')?.aggregate_value).toBe(4);
      expect(meters.meters.find(meter => meter.name === 'total_turns')?.aggregate_value).toBe(7);
      expect(meters.meters.find(meter => meter.name === 'avg_turns_per_session')?.aggregate_value).toBe(1.75);
      expect(meters.meters.find(meter => meter.name === 'min_turns_per_session')?.aggregate_value).toBe(0);
      expect(meters.meters.find(meter => meter.name === 'max_turns_per_session')?.aggregate_value).toBe(4);
      expect(meters.meters.find(meter => meter.name === 'median_turns_per_session')?.aggregate_value).toBe(1.5);
      expect(meters.meters.find(meter => meter.name === 'min_session_duration_ms')?.aggregate_value).toBe(0);
      expect(meters.meters.find(meter => meter.name === 'max_session_duration_ms')?.aggregate_value).toBe(1000);
      expect(meters.meters.find(meter => meter.name === 'median_session_duration_ms')?.aggregate_value).toBe(250);
      expect(meters.meters.find(meter => meter.name === 'p95_session_duration_ms')?.aggregate_value).toBe(910);
    });

    it('includes zero-duration in-flight sessions in duration meters', async () => {
      const { sessionStore, metricsStore } = createStores();
      const start = new Date(Date.now() - 60 * 60 * 1000);
      await sessionStore.createSession({
        tenant_id: tenant,
        session_id: 'inflight-session',
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'reference', id: 'agent-inflight', name: 'Agent InFlight' },
        custom: null,
        metadata: {},
        external_id: null,
        source: null,
      });
      await sessionStore.createSession({
        tenant_id: tenant,
        session_id: 'completed-session',
        created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
        agent: { type: 'reference', id: 'agent-inflight', name: 'Agent InFlight' },
        custom: null,
        metadata: {},
        external_id: null,
        source: null,
      });
      await sessionStore.createTurn(makeCreateTurnInput({ sessionId: 'inflight-session', turnId: 'inflight-turn' }));
      await sessionStore.createTurn(makeCreateTurnInput({ sessionId: 'completed-session', turnId: 'completed-turn' }));
      const turn = mustGet(await sessionStore.getTurn({ session_id: 'completed-session', turn_id: 'completed-turn' }));
      const state = {
        ...makeDoneTurnState(),
        completed_at: new Date(turn.created_at.getTime() + 2000).toISOString(),
      };
      await sessionStore.updateTurnState({
        session_id: 'completed-session',
        turn_id: 'completed-turn',
        state,
        turn_done_event: makeTurnDoneEvent(state),
      });

      const meters = await metricsStore.getSessionMetricsMeters({
        tenant_id: tenant,
        agent_id: 'agent-inflight',
        created_by_subject_id: 'user-1',
        start_timestamp: start,
        end_timestamp: new Date(start.getTime() + 2 * 60 * 60 * 1000),
      });

      expect(meters.meters.find(meter => meter.name === 'total_sessions')?.aggregate_value).toBe(2);
      expect(meters.meters.find(meter => meter.name === 'total_turns')?.aggregate_value).toBe(2);
      expect(meters.meters.find(meter => meter.name === 'min_turns_per_session')?.aggregate_value).toBe(1);
      expect(meters.meters.find(meter => meter.name === 'min_session_duration_ms')?.aggregate_value).toBe(0);
      expect(meters.meters.find(meter => meter.name === 'max_session_duration_ms')?.aggregate_value).toBe(2000);
      expect(meters.meters.find(meter => meter.name === 'median_session_duration_ms')?.aggregate_value).toBe(1000);
      expect(meters.meters.find(meter => meter.name === 'p95_session_duration_ms')?.aggregate_value).toBe(1900);
    });
  });
}
