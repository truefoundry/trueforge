import { z } from 'zod';
import type { TokenPagination } from '../schemas/pagination';
import { decodePageToken, encodePageToken } from './PageToken';

/**
 * Keyset cursor for `listSessions` (`updated_at`, `session_id`).
 * Opaque on the wire; replaces offset tokens for this list only.
 *
 * `updated_at` must retain the store's full precision (Postgres: microseconds via
 * `to_char`; JS Date / SQLite ISO text: milliseconds). Do not round through
 * `Date` before encode/compare — equality on the cursor must match the DB value.
 */
export const SessionListPageCursorSchema = z
  .object({
    updated_at: z.iso.datetime({ offset: true }),
    session_id: z.string().min(1),
  })
  .strict();

export type SessionListPageCursor = z.infer<typeof SessionListPageCursorSchema>;

export function encodeSessionListPageToken(cursor: SessionListPageCursor): string {
  return encodePageToken(SessionListPageCursorSchema, cursor);
}

export function decodeSessionListPageToken(token: string | undefined): SessionListPageCursor | undefined {
  if (token === undefined) {
    return undefined;
  }
  return decodePageToken(SessionListPageCursorSchema, token);
}

export function paginateSessionListRows<T extends { session_id: string }>(
  rows: T[],
  limit: number,
  getUpdatedAtCursor: (row: T) => string,
): { data: T[]; pagination: TokenPagination } {
  const hasMore = rows.length > limit;
  const data = hasMore ? rows.slice(0, limit) : rows;
  const last = data.at(-1);
  return {
    data,
    pagination: {
      limit,
      ...(hasMore && last !== undefined
        ? {
            next_page_token: encodeSessionListPageToken({
              updated_at: getUpdatedAtCursor(last),
              session_id: last.session_id,
            }),
          }
        : {}),
    },
  };
}
