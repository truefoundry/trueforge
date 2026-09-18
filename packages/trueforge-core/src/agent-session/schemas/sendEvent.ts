/**
 * Inbound send-event payloads (client → harness), distinct from the stream log
 * ({@link PersistedTurnEvent} / session_event).
 *
 * Public create is session-scoped (`POST …/sessions/{id}/events`) with body
 * `turn_id` + items. Tip HITL uses approval/tool_response; sticky policies use
 * `user.tool_approval_policy` (session `allow_session`, optional expiry; may later
 * relax tip binding). Per-call allow/deny stays on `user.tool_approval`.
 * `user.message` stays on createTurn / steer.
 */
import { z } from '@hono/zod-openapi';
import {
  EventIdSchema,
  UserToolApprovalMessageSchema,
  UserToolApprovalPolicyMessageSchema,
  UserToolResponseMessageSchema,
} from '../../core/events/schema';

export const SessionInboundEventItemSchema = z
  .discriminatedUnion('type', [
    UserToolApprovalMessageSchema,
    UserToolResponseMessageSchema,
    UserToolApprovalPolicyMessageSchema,
  ])
  .openapi('SessionInboundEventItem');

export type SessionInboundEventItem = z.infer<typeof SessionInboundEventItemSchema>;

const [userToolApprovalItem, userToolResponseItem, userToolApprovalPolicyItem] = SessionInboundEventItemSchema.options;

/**
 * {@link SessionInboundEventItem} + minted `id` / `created_at`.
 * Returned by `POST …/sessions/{id}/events`.
 */
export const CreatedSessionEventSchema = z
  .discriminatedUnion('type', [
    z
      .object({
        ...userToolApprovalItem.shape,
        id: EventIdSchema,
        created_at: z.string().describe('ISO 8601 event timestamp.'),
      })
      .openapi('CreatedUserToolApprovalEvent'),
    z
      .object({
        ...userToolResponseItem.shape,
        id: EventIdSchema,
        created_at: z.string().describe('ISO 8601 event timestamp.'),
      })
      .openapi('CreatedUserToolResponseEvent'),
    z
      .object({
        ...userToolApprovalPolicyItem.shape,
        id: EventIdSchema,
        created_at: z.string().describe('ISO 8601 event timestamp.'),
      })
      .openapi('CreatedUserToolApprovalPolicyEvent'),
  ])
  .openapi('CreatedSessionEvent');

export type CreatedSessionEvent = z.infer<typeof CreatedSessionEventSchema>;
