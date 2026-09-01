/**
 * Internal session metrics route definitions (mounted at /internal/metrics).
 * Handlers are registered in apis/sessionMetrics.ts.
 */
import { createRoute } from '@hono/zod-openapi';
import { RequestErrorResponseSchema } from '../schemas/errors';
import {
  GetSessionMetricsChartDataRequestQuerySchema,
  GetSessionMetricsChartDataResponseSchema,
  GetSessionMetricsChartResponseSchema,
  GetSessionMetricsMeterResponseSchema,
  GetSessionMetricsRequestQuerySchema,
} from '../schemas/sessionMetrics';
import { OpenApiTag } from './openapiTags';

export const getSessionMetricsMetersRoute = createRoute({
  method: 'get',
  path: '/meters',
  tags: [OpenApiTag.INTERNAL],
  summary: 'Get session metrics meters',
  description: "Aggregate the caller's session meters for a named agent over an inclusive creation-time window.",
  'x-fern-sdk-group-name': ['internal', 'metrics'],
  'x-fern-sdk-method-name': 'get_meters',
  request: {
    query: GetSessionMetricsRequestQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetSessionMetricsMeterResponseSchema } },
      description: 'Session metric meters.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid timestamps or a window longer than 30 days.',
    },
  },
});

export const getSessionMetricsChartsRoute = createRoute({
  method: 'get',
  path: '/charts',
  tags: [OpenApiTag.INTERNAL],
  summary: 'Get session metrics charts',
  description: 'List available session metric charts.',
  'x-fern-sdk-group-name': ['internal', 'metrics'],
  'x-fern-sdk-method-name': 'list_charts',
  responses: {
    200: {
      content: { 'application/json': { schema: GetSessionMetricsChartResponseSchema } },
      description: 'Available session metric charts.',
    },
  },
});

export const getSessionMetricsChartsDataRoute = createRoute({
  method: 'get',
  path: '/charts-data',
  tags: [OpenApiTag.INTERNAL],
  summary: 'Get session metrics chart data',
  description:
    "Return one chart for the caller's sessions on a named agent over an inclusive creation-time window. Uses hourly buckets for windows up to 24 hours and daily UTC buckets otherwise.",
  'x-fern-sdk-group-name': ['internal', 'metrics'],
  'x-fern-sdk-method-name': 'get_chart_data',
  request: {
    query: GetSessionMetricsChartDataRequestQuerySchema,
  },
  responses: {
    200: {
      content: { 'application/json': { schema: GetSessionMetricsChartDataResponseSchema } },
      description: 'Zero-filled time series for one chart.',
    },
    400: {
      content: { 'application/json': { schema: RequestErrorResponseSchema } },
      description: 'Invalid timestamps or a window longer than 30 days.',
    },
  },
});
