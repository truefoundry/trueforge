/**
 * Inbound send-event payloads for tip HITL (client → harness), distinct from the
 * stream log ({@link PersistedTurnEvent} / session_event).
 *
 * Public send is session-scoped (`POST …/sessions/{id}/events`) with required
 * body `turn_id` (one batch → one tip) plus `SessionInboundEventItem`s; rows stamp that
 * tip id. v1 union is tip-only; approval policies may relax `turn_id` later.
 * `user.message` stays on createTurn / steer.
 */
import { z } from '@hono/zod-openapi';
import { UserToolApprovalMessageSchema, UserToolResponseMessageSchema } from '../../core/events/schema';

export const SessionInboundEventItemSchema = z
  .discriminatedUnion('type', [UserToolApprovalMessageSchema, UserToolResponseMessageSchema])
  .openapi('SessionInboundEventItem');

export type SessionInboundEventItem = z.infer<typeof SessionInboundEventItemSchema>;
