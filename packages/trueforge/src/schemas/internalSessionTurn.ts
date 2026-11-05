/**
 * Wire schemas for POST /api/internal/sessions/{session_id}/turns.
 * Same body as public create-turn; tenant comes from the session row
 * (lookup by session_id only — same pattern as schedule getRunById).
 */
import { z } from '@hono/zod-openapi';
import { CreateTurnRequestSchema, GetTurnResponseSchema } from './turn';

export const InternalCreateSessionTurnRequestSchema = CreateTurnRequestSchema;

export const InternalCreateSessionTurnResponseSchema = GetTurnResponseSchema;

export type InternalCreateSessionTurnRequest = z.infer<typeof InternalCreateSessionTurnRequestSchema>;
