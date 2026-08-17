import { z } from 'zod';
import type { TokenPagination } from '../schemas/pagination';
import { decodePageToken, encodePageToken } from './PageToken';

export const SessionEventPageCursorSchema = z
  .object({
    last_turn_id: z.string().min(1),
    offset: z.number().int().nonnegative(),
  })
  .strict();

export type SessionEventPageCursor = z.infer<typeof SessionEventPageCursorSchema>;

export function encodeSessionEventPageToken(cursor: SessionEventPageCursor): string {
  return encodePageToken(SessionEventPageCursorSchema, cursor);
}

export function decodeSessionEventPageToken(token: string): SessionEventPageCursor {
  return decodePageToken(SessionEventPageCursorSchema, token);
}

export function paginateSessionEventRows<T>(
  rows: T[],
  limit: number,
  cursor: SessionEventPageCursor,
): { data: T[]; pagination: TokenPagination } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  return {
    data,
    pagination: {
      limit,
      ...(hasMore
        ? {
            next_page_token: encodeSessionEventPageToken({
              last_turn_id: cursor.last_turn_id,
              offset: cursor.offset + limit,
            }),
          }
        : {}),
      ...(cursor.offset > 0
        ? {
            previous_page_token: encodeSessionEventPageToken({
              last_turn_id: cursor.last_turn_id,
              offset: Math.max(0, cursor.offset - limit),
            }),
          }
        : {}),
    },
  };
}
