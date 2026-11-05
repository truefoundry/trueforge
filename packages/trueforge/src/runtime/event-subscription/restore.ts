/**
 * Rebuild a turn's live event stream from the durable log, only when the stream
 * is gone. Durable persist order can differ from emit order, so a stream that
 * still exists is never patched.
 */

export interface RestoreLogOptions<T> {
  /** Durable events, one page at a time. Appended in the order read. */
  readPages: () => AsyncIterable<readonly T[]>;
  streamTTLSeconds?: number | undefined;
}

/** `'stale'` means the tail moved: another writer created or extended the stream. */
export type AppendAfterTailResult = { status: 'ok'; tailEntryId: string } | { status: 'stale' };

/**
 * Appends every page when the stream has no entries. A stream that already has
 * entries is left as is and only gets its TTL refreshed, so a near-expiry
 * stream stays subscribable. The next page's expected tail is the entry id the
 * previous append wrote, so a concurrent writer stops the walk instead of
 * landing between pages.
 */
export async function applyEventLogRestore<T>(input: {
  readPages: () => AsyncIterable<readonly T[]>;
  readTailEntryId: () => Promise<string | undefined>;
  appendAfterTail: (batch: { tailEntryId: string | undefined; events: T[] }) => Promise<AppendAfterTailResult>;
  refreshTtl: () => Promise<void>;
}): Promise<void> {
  if ((await input.readTailEntryId()) !== undefined) {
    await input.refreshTtl();
    return;
  }
  let expectedTailId: string | undefined;
  for await (const page of input.readPages()) {
    if (page.length === 0) {
      continue;
    }
    const outcome = await input.appendAfterTail({ tailEntryId: expectedTailId, events: [...page] });
    if (outcome.status === 'stale') {
      await input.refreshTtl();
      return;
    }
    expectedTailId = outcome.tailEntryId;
  }
}
