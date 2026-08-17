/** Turn product schemas: turn state, input items, and create-turn request. */
import { z } from '@hono/zod-openapi';
import {
  ActionRequiredEventSchema,
  AgentInputUserMessageSchema,
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
    status: z.literal('done').describe('Turn finished (possibly paused for required actions).'),
    output: z
      .union([ModelMessageEventSchema, z.null()])
      .describe('Final `model.message` for the turn, or null when the turn ended paused without a final message.'),
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
    TurnStateDoneSchema,
    TurnStateCancelledSchema,
    TurnStateErrorSchema,
  ])
  .openapi('TurnState');

export const TurnInputItemSchema = z
  .discriminatedUnion('type', [
    AgentInputUserMessageSchema,
    UserToolApprovalMessageSchema,
    UserToolResponseMessageSchema,
  ])
  .openapi('TurnInputItem');

export const TurnSchema = z
  .object({
    id: z.string().describe('Unique turn id.'),
    session_id: z.string().describe('Session that owns this turn.'),
    previous_turn_id: z.string().nullable().describe('Prior turn this turn chains from; null for a root turn.'),
    input: z.array(TurnInputItemSchema).optional().describe('Input items supplied when the turn was created.'),
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
    input: z
      .array(TurnInputItemSchema)
      .optional()
      .describe(
        'Turn input items: user messages and/or approval/tool-response resumes. Do not mix user messages with approval or tool-response items.',
      ),
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
  .superRefine((data, ctx) => {
    if (!data.input) {
      return;
    }
    const hasUser = data.input.some(msg => 'type' in msg && msg.type === 'user.message');
    const hasApprovalOrToolResponse = data.input.some(
      msg => 'type' in msg && (msg.type === 'user.tool_approval' || msg.type === 'user.tool_response'),
    );
    if (hasUser && hasApprovalOrToolResponse) {
      ctx.addIssue({
        code: 'custom',
        message: 'input must not mix user messages with approval decisions or client-side tool responses',
      });
    }
  })
  .openapi('CreateTurnRequest');

export type Turn = z.infer<typeof TurnSchema>;
export type TurnInputItem = z.infer<typeof TurnInputItemSchema>;
export type TurnState = z.infer<typeof TurnStateSchema>;
export type TerminalTurnState = Exclude<TurnState, { status: 'running' }>;
export type TurnMetrics = z.infer<typeof TurnMetricsSchema>;
