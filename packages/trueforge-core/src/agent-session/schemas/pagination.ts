/** Token pagination wire schema. */
import { z } from '@hono/zod-openapi';

export const TokenPaginationSchema = z
  .object({
    next_page_token: z
      .string()
      .optional()
      .describe('Opaque token for the next page. Omit or absent when there is no next page.'),
    previous_page_token: z
      .string()
      .optional()
      .describe('Opaque token for the previous page. Omit or absent when there is no previous page.'),
    limit: z.number().int().positive().describe('Page size used for this response.'),
  })
  .openapi('TokenPagination');

export type TokenPagination = z.infer<typeof TokenPaginationSchema>;
