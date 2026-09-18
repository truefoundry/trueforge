/**
 * Inbound send-event payloads (client → harness), distinct from the stream log
 * ({@link PersistedTurnEvent} / session_event).
 *
 * Public send is session-scoped (`POST …/sessions/{id}/events`) with body
 * `turn_id` + items. Tip HITL uses approval/tool_response; sticky policies use
 * `user.tool_approval_policy` (session `allow_session`, optional expiry; may later
 * relax tip binding). Per-call allow/deny stays on `user.tool_approval`.
 * `user.message` stays on createTurn / steer.
 */
import { z } from '@hono/zod-openapi';
import {
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
  .openapi('SendTurnEventItem');

export type SessionInboundEventItem = z.infer<typeof SessionInboundEventItemSchema>;
