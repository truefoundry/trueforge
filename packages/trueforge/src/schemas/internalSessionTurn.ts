/**
 * Wire schemas for POST /api/internal/session-turns/{session_id}.
 */
import { z } from '@hono/zod-openapi';
import { GetTurnResponseSchema } from './turn';

export const InternalCreateSessionTurnRequestSchema = z
  .object({
    tenant_id: z.string().min(1).describe('Tenant that owns the session.'),
    message: z.string().min(1).describe('User message body for the new turn.'),
  })
  .strict()
  .openapi('InternalCreateSessionTurnRequest');

export const InternalCreateSessionTurnResponseSchema = GetTurnResponseSchema;

export type InternalCreateSessionTurnRequest = z.infer<typeof InternalCreateSessionTurnRequestSchema>;
