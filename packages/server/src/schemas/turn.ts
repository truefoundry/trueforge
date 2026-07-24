/** Server-only turn wire schemas (SSE resume / cancel / list). Core turn schemas live in agent-session. */
import { z } from '@hono/zod-openapi';
import { SessionEventSchema, TokenPaginationSchema, TurnSchema } from '@truefoundry/utils/agent-session';

export { CreateTurnRequestSchema, TurnSchema } from '@truefoundry/utils/agent-session';
export type { Turn } from '@truefoundry/utils/agent-session';

export const SubscribeTurnRequestSchema = z
  .object({
    after_sequence_number: z.number().int().nonnegative().optional(),
  })
  .openapi('SubscribeTurnRequest');

export const CancelSessionRequestSchema = z.object({}).openapi('CancelSessionRequest');
export const CancelSessionResponseSchema = z.object({}).openapi('CancelSessionResponse');

export const DEFAULT_TURNS_LIMIT = 10;
export const TURNS_MAX_LIMIT = 100;

export const ListTurnsRequestQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(TURNS_MAX_LIMIT)
      .optional()
      .default(DEFAULT_TURNS_LIMIT)
      .describe(`Page size. Defaults to ${String(DEFAULT_TURNS_LIMIT)}, max ${String(TURNS_MAX_LIMIT)}.`),
    page_token: z.string().optional().describe('Opaque token from a previous response `next_page_token`.'),
  })
  .openapi('ListTurnsRequestQuery');

export const GetTurnResponseSchema = z
  .object({
    data: TurnSchema,
  })
  .openapi('GetTurnResponse');

export const ListTurnsResponseSchema = z
  .object({
    data: z.array(TurnSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListTurnsResponse');

export const DEFAULT_TURN_EVENTS_LIMIT = 25;
export const TURN_EVENTS_MAX_LIMIT = 100;

export const ListTurnEventsRequestQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(TURN_EVENTS_MAX_LIMIT)
      .optional()
      .default(DEFAULT_TURN_EVENTS_LIMIT)
      .describe(
        `Max events per response. Default ${String(DEFAULT_TURN_EVENTS_LIMIT)}, max ${String(TURN_EVENTS_MAX_LIMIT)}.`,
      ),
    page_token: z.string().optional().describe('Opaque token from a previous response `next_page_token`.'),
    order: z
      .enum(['asc', 'desc'])
      .optional()
      .default('asc')
      .describe('Sort events by insertion order. Defaults to "asc".')
      .openapi('ListTurnEventsOrder'),
  })
  .openapi('ListTurnEventsRequestQuery');

export const ListTurnEventsResponseSchema = z
  .object({
    data: z.array(SessionEventSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListTurnEventsResponse');
