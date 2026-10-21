import type { OperationMetrics } from '@truefoundry/trueforge-core/core';
import { Registry } from 'prom-client';
import { createOperationMetrics } from '../../src/observability/agentMetrics';

/** Recorder on a private registry. Tests do not scrape it. */
export function createTestOperationMetrics(): OperationMetrics {
  return createOperationMetrics(new Registry());
}
