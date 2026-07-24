/** Token pagination wire schema. */
import { z } from '@hono/zod-openapi';

export const TokenPaginationSchema = z
  .object({
    next_page_token: z.string().optional(),
    previous_page_token: z.string().optional(),
    limit: z.number().int().positive(),
  })
  .openapi('TokenPagination');

export type TokenPagination = z.infer<typeof TokenPaginationSchema>;
