/**
 * Internal metrics APIs (mounted at /internal/metrics).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { ResolveUserContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import type { ISessionMetricsStore } from '../db/session-metrics/ISessionMetricsStore';
import { buildSessionMetricsCharts } from '../db/session-metrics/sessionMetrics';
import {
  getSessionMetricsChartsDataRoute,
  getSessionMetricsChartsRoute,
  getSessionMetricsMetersRoute,
} from '../routes/metricsRoutes';
import { TENANT_ID } from './sessions';

export interface InternalMetricsRouterDeps {
  sessionMetricsStore: ISessionMetricsStore;
  agentStore: IAgentStore;
  resolveUserContext: ResolveUserContext;
}

export function createInternalMetricsRouter(deps: InternalMetricsRouterDeps) {
  const router = new OpenAPIHono();

  const requireNamedAgentForSessionMetrics = async (
    agent_id: string,
    c: Parameters<RouteHandler<typeof getSessionMetricsMetersRoute>>[0],
  ) => {
    const agent = await deps.agentStore.getAgent({ tenant_id: TENANT_ID, id: agent_id });
    if (agent === undefined) {
      return c.json({ error: { message: `Agent not found: ${agent_id}` } }, 404);
    }
    return null;
  };

  const getSessionMetricsMetersHandler: RouteHandler<typeof getSessionMetricsMetersRoute> = async c => {
    const query = c.req.valid('query');
    const missingAgent = await requireNamedAgentForSessionMetrics(query.agent_id, c);
    if (missingAgent !== null) {
      return missingAgent;
    }
    const user = deps.resolveUserContext(c);
    const metrics = await deps.sessionMetricsStore.getSessionMetricsMeters({
      tenant_id: TENANT_ID,
      agent_id: query.agent_id,
      created_by: user.userRef,
      start_timestamp: query.start_timestamp,
      end_timestamp: query.end_timestamp,
    });
    return c.json({ data: metrics }, 200);
  };

  const getSessionMetricsChartsHandler: RouteHandler<typeof getSessionMetricsChartsRoute> = c => {
    return c.json({ data: buildSessionMetricsCharts() }, 200);
  };

  const getSessionMetricsChartsDataHandler: RouteHandler<typeof getSessionMetricsChartsDataRoute> = async c => {
    const query = c.req.valid('query');
    const missingAgent = await requireNamedAgentForSessionMetrics(query.agent_id, c);
    if (missingAgent !== null) {
      return missingAgent;
    }
    const user = deps.resolveUserContext(c);
    const chartData = await deps.sessionMetricsStore.getSessionMetricsChartData({
      tenant_id: TENANT_ID,
      agent_id: query.agent_id,
      created_by: user.userRef,
      start_timestamp: query.start_timestamp,
      end_timestamp: query.end_timestamp,
      chart_name: query.chart_name,
    });
    return c.json({ data: chartData }, 200);
  };

  router.openapi(getSessionMetricsMetersRoute, getSessionMetricsMetersHandler);
  router.openapi(getSessionMetricsChartsRoute, getSessionMetricsChartsHandler);
  router.openapi(getSessionMetricsChartsDataRoute, getSessionMetricsChartsDataHandler);
  return router;
}
