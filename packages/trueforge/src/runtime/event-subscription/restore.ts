/**
 * Rebuild a turn's live event stream from the durable log, only when the stream
 * is gone. Durable persist order can differ from emit order, so a stream that
 * still exists is never patched.
 */

export interface RestoreLogOptions<T> {
  /** Durable events, one page at a time, in the order to append. */
  readPages: () => AsyncIterable<readonly T[]>;
  streamTTLSeconds?: number | undefined;
}

/**
 * `present`: the stream already existed. `installed`: the log was written.
 * `lost_race`: another writer created the stream while the log was being read.
 */
export type RestoreLogOutcome = 'present' | 'installed' | 'lost_race';

/**
 * Installs the whole log when the stream is still absent. Reports `lost_race` when the
 * stream was created first: the caller refreshes its TTL and keeps it as is.
 */
export async function applyEventLogRestore<T>(input: {
  readPages: () => AsyncIterable<readonly T[]>;
  readTailEntryId: () => Promise<string | undefined>;
  installIfAbsent: (pages: AsyncIterable<readonly T[]>) => Promise<boolean>;
  refreshTtl: () => Promise<void>;
}): Promise<RestoreLogOutcome> {
  if ((await input.readTailEntryId()) !== undefined) {
    await input.refreshTtl();
    return 'present';
  }
  const installed = await input.installIfAbsent(input.readPages());
  if (installed) {
    return 'installed';
  }
  await input.refreshTtl();
  return 'lost_race';
}
