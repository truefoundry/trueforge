/**
 * Session-store-only helpers for SQLite (append_id ordering quirks).
 * Shared JSON/time helpers live in `../sqlExpressions`.
 */

/**
 * SQLite RETURNING row order is unspecified. Multi-row INSERT assigns increasing
 * append_id in VALUES order — sort on that before mapping to pos / per-thread lists.
 */
export function sortedByAppendId<T extends { append_id: number }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => a.append_id - b.append_id);
}
