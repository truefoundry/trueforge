/**
 * Wire schemas for POST /api/internal/sessions/{session_id}/turns.
 * Same turn body as public create-turn, plus tenant_id (service key has no JWT tenant).
 */
import { z } from '@hono/zod-openapi';
import { CreateTurnRequestSchema, GetTurnResponseSchema } from './turn';

export const InternalCreateSessionTurnRequestSchema = z
  .intersection(
    z.object({
      tenant_id: z.string().min(1).describe('Tenant that owns the session.'),
    }),
    CreateTurnRequestSchema,
  )
  .openapi('InternalCreateSessionTurnRequest');

export const InternalCreateSessionTurnResponseSchema = GetTurnResponseSchema;

export type InternalCreateSessionTurnRequest = z.infer<typeof InternalCreateSessionTurnRequestSchema>;
