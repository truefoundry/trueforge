/**
 * Internal session metrics APIs (mounted at /api/internal/metrics).
 */
import { OpenAPIHono, type RouteHandler } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { Authorizer } from '../auth/authorizer';
import type { ResolveRequestContext } from '../auth/identity';
import type { IAgentStore } from '../db/agentStore';
import { buildSessionMetricsCharts, type ISessionMetricsStore } from '../db/sessionMetricsStore';
import {
  getSessionMetricsChartsDataRoute,
  getSessionMetricsChartsRoute,
  getSessionMetricsMetersRoute,
} from '../routes/sessionMetricsRoutes';
import { resolveManagedAgentIds } from './agentAccess';

export interface InternalMetricsRouterDeps {
  sessionMetricsStore: ISessionMetricsStore;
  resolveRequestContext: ResolveRequestContext;
  resolveAgentStore: (c: Context) => IAgentStore;
  authorizer: Authorizer;
}

export function createInternalMetricsRouter(deps: InternalMetricsRouterDeps) {
  const router = new OpenAPIHono();

  const getSessionMetricsMetersHandler: RouteHandler<typeof getSessionMetricsMetersRoute> = async c => {
    const query = c.req.valid('query');
    const requestContext = deps.resolveRequestContext(c);
    const managedAgentIds = await resolveManagedAgentIds({
      store: deps.resolveAgentStore(c),
      context: requestContext,
      authorizer: deps.authorizer,
    });
    const metrics = await deps.sessionMetricsStore.getSessionMetricsMeters({
      tenant_id: requestContext.tenant_id,
      agent_id: query.agent_id,
      created_by_subject_id: managedAgentIds.includes(query.agent_id) ? undefined : requestContext.subject.id,
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
    const requestContext = deps.resolveRequestContext(c);
    const managedAgentIds = await resolveManagedAgentIds({
      store: deps.resolveAgentStore(c),
      context: requestContext,
      authorizer: deps.authorizer,
    });
    const chartData = await deps.sessionMetricsStore.getSessionMetricsChartData({
      tenant_id: requestContext.tenant_id,
      agent_id: query.agent_id,
      created_by_subject_id: managedAgentIds.includes(query.agent_id) ? undefined : requestContext.subject.id,
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
