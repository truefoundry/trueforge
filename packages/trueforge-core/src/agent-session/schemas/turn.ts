import { z } from '@hono/zod-openapi';
import {
  ActionRequiredEventSchema,
  ModelMessageEventSchema,
  UserMessageSchema,
  UserToolApprovalMessageSchema,
  UserToolResponseMessageSchema,
} from '../../core/events/schema';
import { AgentThreadMetricsSchema } from '../../core/runtime/metrics';

export enum CancellationReason {
  // AbortController.abort() reason for the max-execution timer.
  ServerExecutionTimeout = 'server-execution-timeout',
  // Emitted when the client cancels the run.
  ClientCancelled = 'client-cancelled',
  // Prior turn aborted because the client started a new turn.
  CancelledForNextTurn = 'cancelled-for-next-turn',
  // Process shutting down (SIGTERM/SIGINT).
  Abandoned = 'abandoned',
}

/** Every `TurnState` arm takes its `status` literal from here. */
export const TurnStatusSchema = z.enum(['running', 'paused', 'done', 'cancelled', 'error']).openapi('TurnStatus');

/** Billable aggregate for one turn. */
export const TurnMetricsSchema = z
  .object({
    total_input_tokens: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Total input tokens across model calls in this turn.'),
    total_output_tokens: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Total output tokens across model calls in this turn.'),
    total_tokens: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Total tokens (input + output) across model calls in this turn.'),
    total_cache_read_tokens: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Total cache-read tokens across model calls in this turn.'),
    total_cache_write_tokens: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Total cache-write tokens across model calls in this turn.'),
    total_reasoning_tokens: z
      .number()
      .int()
      .nonnegative()
      .optional()
      .describe('Total reasoning tokens across model calls in this turn.'),
    total_cost_in_usd: z.number().nonnegative().optional().describe('Estimated total cost in USD for this turn.'),
  })
  .openapi('TurnMetrics');

export const TurnStateRunningSchema = z
  .object({
    status: z.literal(TurnStatusSchema.enum.running).describe('Turn is still executing.'),
  })
  .openapi('TurnStateRunning');

export const TurnStatePausedSchema = z
  .object({
    status: z.literal(TurnStatusSchema.enum.paused).describe('Turn is paused waiting for user actions.'),
    metrics: TurnMetricsSchema.optional().describe('Billable aggregate for this turn so far.'),
  })
  .openapi('TurnStatePaused');

export const TurnStateCancelledReasonSchema = z
  .enum(CancellationReason)
  .describe('Reason for the cancellation.')
  .openapi('TurnStateCancelledReason');

export const TurnStateCancelledSchema = z
  .object({
    status: z.literal(TurnStatusSchema.enum.cancelled).describe('Turn was cancelled before completion.'),
    reason: TurnStateCancelledReasonSchema,
    completed_at: z.string().describe('ISO 8601 time when cancellation completed.'),
    metrics: TurnMetricsSchema.optional().describe('Optional billable aggregate for work done before cancel.'),
  })
  .openapi('TurnStateCancelled');

export const TurnStateErrorSchema = z
  .object({
    status: z.literal(TurnStatusSchema.enum.error).describe('Turn ended with an error.'),
    message: z.string().describe('Human-readable error message.'),
    completed_at: z.string().describe('ISO 8601 time when the error state was recorded.'),
    metrics: TurnMetricsSchema.optional().describe('Optional billable aggregate for work done before the error.'),
  })
  .openapi('TurnStateError');

export const TurnStateDoneSchema = z
  .object({
    status: z.literal(TurnStatusSchema.enum.done).describe('Turn finished with no open required actions.'),
    output: z
      .union([ModelMessageEventSchema, z.null()])
      .describe('Final `model.message` for the turn, or null when the turn ended without a final message.'),
    required_actions: z
      .array(ActionRequiredEventSchema)
      .describe(
        'Pending actions (`tool.approval_required`, `tool.response_required`, `mcp.auth_required`); empty when none.',
      ),
    completed_at: z.string().describe('ISO 8601 time when the turn reached a terminal state.'),
    metrics: TurnMetricsSchema.optional().describe('Optional billable aggregate for the whole turn.'),
  })
  .openapi('TurnStateDone');

export const TurnStateSchema = z
  .discriminatedUnion('status', [
    TurnStateRunningSchema,
    TurnStatePausedSchema,
    TurnStateDoneSchema,
    TurnStateCancelledSchema,
    TurnStateErrorSchema,
  ])
  .openapi('TurnState');

/**
 * Historical turn rows may contain approval decisions and client-side tool responses
 * because those inputs created continuation turns before the turn-events endpoint existed.
 * New turns accept only UserMessageSchema through CreateTurnRequestSchema.
 */
export const LegacyTurnInputItemSchema = z
  .discriminatedUnion('type', [UserMessageSchema, UserToolApprovalMessageSchema, UserToolResponseMessageSchema])
  .openapi('LegacyTurnInputItem');

export const TurnSchema = z
  .object({
    id: z.string().describe('Unique turn id.'),
    session_id: z.string().describe('Session that owns this turn.'),
    previous_turn_id: z.string().nullable().describe('Prior turn this turn chains from; null for a root turn.'),
    input: z
      .array(LegacyTurnInputItemSchema)
      .optional()
      .describe('Inputs stored when the turn was created, including legacy continuation inputs.'),
    state: TurnStateSchema,
    created_at: z.string().describe('ISO 8601 creation timestamp.'),
  })
  .openapi('Turn');

/**
 * Wire type for the previous_turn_id field. Includes the default so the schema
 * can be referenced directly without re-wrapping (re-wrapping strips the $ref).
 */
export const CreateTurnRequestSchema = z
  .object({
    input: z.array(UserMessageSchema).optional().describe('User messages supplied when the turn is created.'),
    previous_turn_id: z
      .union([z.literal('auto'), z.literal('none'), z.string().min(1)])
      .optional()
      .default('auto')
      .describe(`Defaults to 'auto' (chain to session last turn). Use 'none' for a new root turn.`)
      .openapi('PreviousTurnIdInput'),
    stream: z
      .boolean()
      .optional()
      .default(true)
      .describe('When true (default), stream turn events as SSE. When false, return the running turn immediately.'),
  })
  .openapi('CreateTurnRequest');

/**
 * Accumulated billable totals, closed active duration, and the open running interval.
 * `running_since` is null while paused.
 */
export const TurnMetricsCheckpointSchema = z.object({
  metrics: AgentThreadMetricsSchema,
  active_duration_ms: z.number().int().nonnegative(),
  running_since: z.string().nullable(),
});

/** Pause sends the stretch since the last resume. Resume only opens the next interval. */
export const TurnNonTerminalMetricsSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('paused'),
    observed_at: z.string(),
    metrics: AgentThreadMetricsSchema,
  }),
  z.object({
    status: z.literal('running'),
    observed_at: z.string(),
  }),
]);

export type Turn = z.infer<typeof TurnSchema>;
export type LegacyTurnInputItem = z.infer<typeof LegacyTurnInputItemSchema>;
export type TurnState = z.infer<typeof TurnStateSchema>;
export type NonTerminalTurnState = Extract<TurnState, { status: 'running' | 'paused' }>;
export type TerminalTurnState = Exclude<TurnState, NonTerminalTurnState>;
export type TurnMetrics = z.infer<typeof TurnMetricsSchema>;
export type TurnMetricsCheckpoint = z.infer<typeof TurnMetricsCheckpointSchema>;
export type TurnNonTerminalMetrics = z.infer<typeof TurnNonTerminalMetricsSchema>;

export function isNonTerminalTurnState(state: TurnState): state is NonTerminalTurnState {
  return state.status === 'running' || state.status === 'paused';
}
