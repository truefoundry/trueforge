/**
 * Inbound send-event payloads for tip HITL (client → harness), distinct from the
 * stream log ({@link PersistedTurnEvent} / session_event).
 *
 * Public create is turn-scoped (`POST …/sessions/{id}/turns/{turn_id}/events`)
 * with `TurnInboundEventItem`s. `user.message` stays on createTurn / steer.
 */
import { z } from '@hono/zod-openapi';
import { UserToolApprovalMessageSchema, UserToolResponseMessageSchema } from '../../core/events/schema';

export const TurnInboundEventItemSchema = z
  .discriminatedUnion('type', [UserToolApprovalMessageSchema, UserToolResponseMessageSchema])
  .openapi('TurnInboundEventItem');

export type TurnInboundEventItem = z.infer<typeof TurnInboundEventItemSchema>;
