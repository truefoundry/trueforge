import type { OperationMetrics } from '@truefoundry/trueforge-core/core';
import { Registry } from 'prom-client';
import { createOperationMetrics } from '../../src/observability/agentMetrics';

/** One recorder for tests that must pass `OperationMetrics`. Tests do not scrape it. */
export const metrics: OperationMetrics = createOperationMetrics(new Registry());
