/**
 * Public-boundary smoke fixture: npm + intra-harness imports only.
 * Lint with the harness fixtures eslint override; expect zero diagnostics.
 */
import { z } from 'zod';
import { EventType } from '../../../src/core/events/schema';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';

export const BoundaryValidSchema = z.object({
  type: z.literal(EventType.USER_MESSAGE),
  tracingOk: z.literal(true),
});

export const boundaryValidTracing = NOOP_AGENT_TRACING;
