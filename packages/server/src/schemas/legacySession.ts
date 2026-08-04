/** Legacy (YAML) session wire schemas for /api/v1/legacy/sessions. */
import { z } from '@hono/zod-openapi';
import {
  LegacyCreateSessionRequestSchema,
  LegacySessionSchema,
  LegacyUpdateSessionRequestSchema,
  TokenPaginationSchema,
} from '@truefoundry/utils/agent-session';

export type { LegacySession } from '@truefoundry/utils/agent-session';
export { LegacyCreateSessionRequestSchema, LegacyUpdateSessionRequestSchema };

export const GetLegacySessionResponseSchema = z
  .object({
    data: LegacySessionSchema,
  })
  .openapi('GetLegacySessionResponse');

export const ListLegacySessionsResponseSchema = z
  .object({
    data: z.array(LegacySessionSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListLegacySessionsResponse');
