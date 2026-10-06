import { z } from '@hono/zod-openapi';
import {
  ActionRequiredEventSchema,
  InputUserMessageSchema,
  ModelMessageEventSchema,
  UserToolApprovalMessageSchema,
  UserToolResponseMessageSchema,
} from '../../core/events/schema';

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

export const TurnStateRunningSchema = z
  .object({
    status: z.literal('running').describe('Turn is still executing.'),
  })
  .openapi('TurnStateRunning');

export const TurnStatePausedSchema = z
  .object({
    status: z.literal('paused').describe('Turn is paused waiting for user actions.'),
  })
  .openapi('TurnStatePaused');

export const TurnStateCancelledReasonSchema = z
  .enum(CancellationReason)
  .describe('Reason for the cancellation.')
  .openapi('TurnStateCancelledReason');

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

export const TurnStateCancelledSchema = z
  .object({
    status: z.literal('cancelled').describe('Turn was cancelled before completion.'),
    reason: TurnStateCancelledReasonSchema,
    completed_at: z.string().describe('ISO 8601 time when cancellation completed.'),
    metrics: TurnMetricsSchema.optional().describe('Optional billable aggregate for work done before cancel.'),
  })
  .openapi('TurnStateCancelled');

export const TurnStateErrorSchema = z
  .object({
    status: z.literal('error').describe('Turn ended with an error.'),
    message: z.string().describe('Human-readable error message.'),
    completed_at: z.string().describe('ISO 8601 time when the error state was recorded.'),
    metrics: TurnMetricsSchema.optional().describe('Optional billable aggregate for work done before the error.'),
  })
  .openapi('TurnStateError');

export const TurnStateDoneSchema = z
  .object({
    status: z.literal('done').describe('Turn finished with no open required actions.'),
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
 * New turns accept only InputUserMessageSchema through CreateTurnRequestSchema.
 */
export const LegacyTurnInputItemSchema = z
  .discriminatedUnion('type', [InputUserMessageSchema, UserToolApprovalMessageSchema, UserToolResponseMessageSchema])
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
    input: z.array(InputUserMessageSchema).optional().describe('User messages supplied when the turn is created.'),
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

export type Turn = z.infer<typeof TurnSchema>;
export type LegacyTurnInputItem = z.infer<typeof LegacyTurnInputItemSchema>;
export type TurnState = z.infer<typeof TurnStateSchema>;
export type NonTerminalTurnState = Extract<TurnState, { status: 'running' | 'paused' }>;
export type TerminalTurnState = Exclude<TurnState, NonTerminalTurnState>;
export type TurnMetrics = z.infer<typeof TurnMetricsSchema>;

export function isNonTerminalTurnState(state: TurnState): state is NonTerminalTurnState {
  return state.status === 'running' || state.status === 'paused';
}
