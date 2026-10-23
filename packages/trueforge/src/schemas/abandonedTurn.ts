/**
 * Wire schemas for internal abandoned-turn closer endpoints.
 */
import { z } from '@hono/zod-openapi';

export const AbandonedTurnSchema = z
  .object({
    tenant_id: z.string().min(1).describe('Tenant that owns the session.'),
    session_id: z.string().min(1).describe('Session that owns the turn.'),
    turn_id: z.string().min(1).describe('Running turn with stale last activity.'),
  })
  .strict()
  .openapi('AbandonedTurn');

export const ListAbandonedTurnsResponseSchema = z
  .object({
    data: z.array(AbandonedTurnSchema),
  })
  .strict()
  .openapi('ListAbandonedTurnsResponse');

export const CloseAbandonedTurnRequestSchema = z
  .object({
    tenant_id: z.string().min(1).describe('Tenant that owns the session.'),
    session_id: z.string().min(1).describe('Session that owns the turn.'),
    turn_id: z.string().min(1).describe('Turn to close.'),
  })
  .strict()
  .openapi('CloseAbandonedTurnRequest');
