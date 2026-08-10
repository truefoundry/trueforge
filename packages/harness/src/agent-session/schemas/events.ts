/**
 * Turn/session event product schemas. Event payloads come from the harness; this
 * module owns turn lifecycle events (turn.created / turn.done) and the persisted
 * event unions the store writes. SSE streaming envelopes stay in server/schemas.
 */
import { z } from '@hono/zod-openapi';
import type { WithRegisteredPassthrough } from '../../core/events/PassthroughEvents';
import {
  EventIdSchema,
  EventType as HarnessEventType,
  MCPAuthRequiredEventSchema,
  MCPInitializeEventSchema,
  ModelMessageEventSchema,
  SandboxCreatedEventSchema,
  ThreadCreatedEventSchema,
  ThreadDoneEventSchema,
  ToolApprovalRequiredEventSchema,
  ToolResponseEventSchema,
  ToolResponseRequiredEventSchema,
} from '../../core/events/schema';
import {
  TurnInputItemSchema,
  TurnStateCancelledSchema,
  TurnStateDoneSchema,
  TurnStateErrorSchema,
  TurnStateRunningSchema,
} from './turn';

/** Harness event types plus the turn lifecycle types owned by agentSession. */
export const EventType = {
  ...HarnessEventType,
  TURN_CREATED: 'turn.created',
  TURN_DONE: 'turn.done',
} as const;

export const TurnCreatedEventSchema = z
  .object({
    type: z.literal(EventType.TURN_CREATED).describe('Emitted when a turn starts.'),
    id: EventIdSchema,
    turn_id: z.string().describe('Id of the newly created turn.'),
    previous_turn_id: z.string().nullable().describe('Prior turn this turn chains from; null for a root turn.'),
    input: z.array(TurnInputItemSchema).optional().describe('Input items supplied when the turn was created.'),
    state: TurnStateRunningSchema,
    created_at: z.string().describe('ISO 8601 event timestamp.'),
    thread_id: z.string().nullable().describe('Thread that owns the event; null for turn-level lifecycle events.'),
  })
  .openapi('TurnCreatedEvent');

export const TurnDoneEventSchema = z
  .object({
    type: z.literal(EventType.TURN_DONE).describe('Emitted when a turn reaches a terminal state.'),
    id: EventIdSchema,
    state: z
      .discriminatedUnion('status', [TurnStateDoneSchema, TurnStateCancelledSchema, TurnStateErrorSchema])
      .describe('Terminal turn state (done, cancelled, or error).'),
    created_at: z.string().describe('ISO 8601 event timestamp.'),
    thread_id: z.string().nullable().describe('Thread that owns the event; null for turn-level lifecycle events.'),
  })
  .openapi('TurnDoneEvent');

/** Built-in durable turn events — lifecycle + content; no deltas, no passthrough. */
export const SessionEventSchema = z
  .discriminatedUnion('type', [
    TurnCreatedEventSchema,
    TurnDoneEventSchema,
    ModelMessageEventSchema,
    ToolResponseEventSchema,
    ThreadCreatedEventSchema,
    ThreadDoneEventSchema,
    MCPAuthRequiredEventSchema,
    MCPInitializeEventSchema,
    SandboxCreatedEventSchema,
    ToolApprovalRequiredEventSchema,
    ToolResponseRequiredEventSchema,
  ])
  .openapi('SessionEvent');

/** One row on the session timeline: which turn emitted the event plus the event payload. */
export const SessionEventItemSchema = z
  .object({
    turn_id: z.string().describe('Turn that emitted this event.'),
    event: SessionEventSchema,
  })
  .openapi('SessionEventItem');

export type TurnCreatedEvent = z.infer<typeof TurnCreatedEventSchema>;
export type TurnDoneEvent = z.infer<typeof TurnDoneEventSchema>;
export type SessionEvent = z.infer<typeof SessionEventSchema>;
/**
 * Durable turn event log entries: {@link SessionEvent} plus any registered
 * passthrough events. Every merged event must carry its monotonic ULID and
 * creation timestamp; shared by append and list operations.
 */
export type PersistedTurnEvent = WithRegisteredPassthrough<SessionEvent> & {
  id: string;
  created_at: string;
};
export interface SessionEventItem {
  turn_id: string;
  event: PersistedTurnEvent;
}
