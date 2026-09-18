/**
 * Server event wire schemas: SSE streaming union + list-query envelopes.
 * Lifecycle / persisted event schemas live in agentSession.
 */
import { z } from '@hono/zod-openapi';
import {
  CreatedSessionEventSchema,
  EventType,
  SessionEventItemSchema,
  SessionInboundEventItemSchema,
  TokenPaginationSchema,
  TurnCreatedEventSchema,
  TurnDoneEventSchema,
  TurnUpdateEventSchema,
} from '@truefoundry/trueforge-core/agent-session';
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
} from '@truefoundry/trueforge-core/core';
import { EVENTS_PAGE_LIMIT } from './common';

export type { TurnCreatedEvent } from '@truefoundry/trueforge-core/agent-session';
export { EventType };

/** Client → harness inbound events (tip HITL / sticky policy). Persisted to the session inbox. */
export const CreateSessionEventRequestSchema = z
  .object({
    turn_id: z
      .string()
      .min(1)
      .describe('Tip turn that receives this batch. Must be non-terminal (running; paused when that status lands).'),
    events: z
      .array(SessionInboundEventItemSchema)
      .min(1)
      .describe('One or more inbound items (`user.tool_approval`, `user.tool_response`, `user.tool_approval_policy`).'),
  })
  .openapi('CreateSessionEventRequest');

export const CreateSessionEventResponseSchema = z
  .object({
    data: z
      .array(CreatedSessionEventSchema)
      .describe('Created inbox events with server-minted `id` and `created_at`, in request order.'),
  })
  .openapi('CreateSessionEventResponse');

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
    TurnUpdateEventSchema,
    TurnDoneEventSchema,
  ])
  .openapi('TurnStreamingEvent');

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
      .max(EVENTS_PAGE_LIMIT)
      .optional()
      .default(EVENTS_PAGE_LIMIT)
      .describe(`Page size. Defaults to ${String(EVENTS_PAGE_LIMIT)}, max ${String(EVENTS_PAGE_LIMIT)}.`),
  })
  .openapi('ListSessionEventsRequestQuery');

export const ListSessionEventsResponseSchema = z
  .object({
    data: z.array(SessionEventItemSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListSessionEventsResponse');

export type TurnStreamingEvent = z.infer<typeof TurnStreamingEventSchema>;
