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
