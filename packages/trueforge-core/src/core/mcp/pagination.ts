import type { Logger } from 'winston';

/**
 * Walk an MCP cursor-paginated list to completion, guarding against servers that return a
 * previously seen cursor (which would otherwise loop forever). If a repeated cursor is seen the
 * loop stops and (when a logger is supplied) a warning is emitted naming the server.
 */
export async function paginateWithCursorGuard<T>(
  fetchNext: (cursor: string | undefined) => Promise<{ items: T[]; nextCursor?: string | undefined }>,
  serverIdentifier: string | undefined,
  logger?: Logger,
): Promise<T[]> {
  const allItems: T[] = [];
  const seenCursors = new Set<string>();
  const serverName = serverIdentifier ?? 'unknown';

  const firstResult = await fetchNext(undefined);
  allItems.push(...firstResult.items);
  let cursor = firstResult.nextCursor;

  while (cursor) {
    if (seenCursors.has(cursor)) {
      logger?.warn(`Detected repeated cursor "${cursor}" from server ${serverName}. Breaking pagination loop.`);
      break;
    }
    seenCursors.add(cursor);

    const result = await fetchNext(cursor);
    allItems.push(...result.items);
    cursor = result.nextCursor;
  }

  return allItems;
}
