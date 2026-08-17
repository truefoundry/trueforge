import { z } from 'zod';
import type { TokenPagination } from '../schemas/pagination';
import { decodePageToken, encodePageToken } from './PageToken';

export const OffsetPageCursorSchema = z
  .object({
    offset: z.number().int().nonnegative(),
  })
  .strict();

export type OffsetPageCursor = z.infer<typeof OffsetPageCursorSchema>;

export function encodeOffsetPageToken(offset: number): string {
  return encodePageToken(OffsetPageCursorSchema, { offset });
}

export function decodeOffsetPageToken(token: string | undefined): number {
  if (token === undefined || token === '') {
    return 0;
  }
  return decodePageToken(OffsetPageCursorSchema, token).offset;
}

export function paginateOffsetRows<T>(
  rows: T[],
  limit: number,
  offset: number,
): { data: T[]; pagination: TokenPagination } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    pagination: {
      limit,
      ...(hasMore ? { next_page_token: encodeOffsetPageToken(offset + limit) } : {}),
      ...(offset > 0 ? { previous_page_token: encodeOffsetPageToken(Math.max(0, offset - limit)) } : {}),
    },
  };
}
