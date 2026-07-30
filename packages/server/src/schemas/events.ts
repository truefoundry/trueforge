/**
 * Server event wire schemas: SSE streaming union + list-query envelopes.
 * Lifecycle / persisted event schemas live in agentSession.
 */
import { z } from '@hono/zod-openapi';
import {
  EventType,
  SessionEventItemSchema,
  TokenPaginationSchema,
  TurnCreatedEventSchema,
  TurnDoneEventSchema,
} from '@truefoundry/utils/agent-session';
import {
  MCPAuthRequiredEventSchema,
  MCPInitializeEventSchema,
  ModelMessageDeltaEventSchema,
  ModelMessageEventSchema,
  SandboxCreatedEventSchema,
  ThreadCreatedEventSchema,
  ThreadDoneEventSchema,
  ToolApprovalRequiredEventSchema,
  ToolResponseEventSchema,
  ToolResponseRequiredEventSchema,
} from '@truefoundry/utils/core';

export type { TurnCreatedEvent } from '@truefoundry/utils/agent-session';
export { EventType };

/**
 * Runtime boundary for the resumable turn stream store. Registered passthrough
 * events extend the streaming union at the type level only, so stored entries
 * are validated against this envelope instead of the closed discriminated union.
 */
export const StoredTurnStreamingEventSchema = z.object({ type: z.string() }).passthrough();
export type StoredTurnStreamingEvent = z.infer<typeof StoredTurnStreamingEventSchema>;

export function parseStoredTurnStreamingEvent(raw: unknown): StoredTurnStreamingEvent {
  return StoredTurnStreamingEventSchema.parse(raw);
}

/** Live SSE stream for session turns — content events, deltas and lifecycle. */
export const TurnStreamingEventSchema = z
  .discriminatedUnion('type', [
    ModelMessageEventSchema,
    ModelMessageDeltaEventSchema,
    ToolResponseEventSchema,
    ThreadCreatedEventSchema,
    ThreadDoneEventSchema,
    MCPAuthRequiredEventSchema,
    MCPInitializeEventSchema,
    SandboxCreatedEventSchema,
    ToolApprovalRequiredEventSchema,
    ToolResponseRequiredEventSchema,
    TurnCreatedEventSchema,
    TurnDoneEventSchema,
  ])
  .openapi('TurnStreamingEvent');

/** Max events per session-events page. */
export const SESSION_EVENTS_LIMIT = 100;

export const ListSessionEventsRequestQuerySchema = z
  .object({
    page_token: z
      .string()
      .optional()
      .describe(
        'Pagination cursor from `pagination.next_page_token`. It retains the branch anchor turn and returns older events toward the session start.',
      ),
    last_turn_id: z
      .string()
      .optional()
      .describe(
        'Newest turn in the listing window (initial load only; ignored when `page_token` is set). Lists that turn and its ancestors, newest events first. Omit to use the session last turn.',
      ),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(SESSION_EVENTS_LIMIT)
      .optional()
      .default(SESSION_EVENTS_LIMIT)
      .describe(
        `Max events per response. Default ${String(SESSION_EVENTS_LIMIT)}, max ${String(SESSION_EVENTS_LIMIT)}.`,
      ),
  })
  .openapi('ListSessionEventsRequestQuery');

export const ListSessionEventsResponseSchema = z
  .object({
    data: z.array(SessionEventItemSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListSessionEventsResponse');

export type TurnStreamingEvent = z.infer<typeof TurnStreamingEventSchema>;
