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
    status: z.literal('running'),
  })
  .openapi('TurnStateRunning');

export const TurnStateCancelledReasonSchema = z
  .nativeEnum(CancellationReason)
  .describe('Reason for the cancellation.')
  .openapi('TurnStateCancelledReason');

export const TurnStateCancelledSchema = z
  .object({
    status: z.literal('cancelled'),
    reason: TurnStateCancelledReasonSchema,
    completed_at: z.string(),
  })
  .openapi('TurnStateCancelled');

export const TurnStateErrorSchema = z
  .object({
    status: z.literal('error'),
    message: z.string(),
    completed_at: z.string(),
  })
  .openapi('TurnStateError');

export const TurnStateDoneSchema = z
  .object({
    status: z.literal('done'),
    output: ModelMessageEventSchema.nullable(),
    required_actions: z.array(ActionRequiredEventSchema),
    completed_at: z.string(),
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
    id: z.string(),
    session_id: z.string(),
    previous_turn_id: z.string().nullable(),
    input: z.array(TurnInputItemSchema).optional(),
    state: TurnStateSchema,
    created_at: z.string(),
  })
  .openapi('Turn');

export const PreviousTurnIdInputSchema = z
  .union([z.literal('auto'), z.string().min(1)])
  .nullable()
  .openapi('PreviousTurnIdInput');

export const CreateTurnRequestSchema = z
  .object({
    input: z.array(TurnInputItemSchema).optional(),
    previous_turn_id: PreviousTurnIdInputSchema.optional()
      .default('auto')
      .describe(`Defaults to 'auto' (chain to session last turn). Use 'null' for the session's first turn.`),
  })
  .superRefine((data, ctx) => {
    if (!data.input) return;
    const hasUser = data.input.some(msg => 'type' in msg && msg.type === 'user.message');
    const hasApprovalOrToolResponse = data.input.some(
      msg => 'type' in msg && (msg.type === 'user.tool_approval' || msg.type === 'user.tool_response'),
    );
    if (hasUser && hasApprovalOrToolResponse) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'input must not mix user messages with approval decisions or client-side tool responses',
      });
    }
  })
  .openapi('CreateTurnRequest');

export type Turn = z.infer<typeof TurnSchema>;
export type TurnInputItem = z.infer<typeof TurnInputItemSchema>;
export type TurnState = z.infer<typeof TurnStateSchema>;
export type TerminalTurnState = Exclude<TurnState, { status: 'running' }>;
