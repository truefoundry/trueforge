import type { ISessionStore, TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session';
import { extractErrorLogFields } from '@truefoundry/trueforge-core/core/util/errorLogFields';
import type { Logger } from 'winston';
import type { EventSubscription, RestoreLogOutcome } from './event-subscription';

/** Large pages keep a full restore to few round trips. */
const RESTORE_PAGE_LIMIT = 1_000;

/** Counts across pages, reported once the restore ends. */
interface RestoreProgress {
  pages: number;
  events: number;
}

/**
 * Restore a paused turn's live stream from the durable log when the stream is gone.
 * An existing stream is never patched: persist order can differ from emit order.
 */
export async function restoreTurnEventLog<TTransaction>(input: {
  sessionStore: Pick<ISessionStore<TTransaction>, 'listTurnEvents'>;
  subscription: EventSubscription<TurnStreamingEvent>;
  logger: Logger;
  sessionId: string;
  turnId: string;
  streamTTLSeconds: number;
}): Promise<void> {
  const progress: RestoreProgress = { pages: 0, events: 0 };
  const startedAt = performance.now();
  let outcome: RestoreLogOutcome;
  try {
    outcome = await input.subscription.restoreLog({
      readPages: () => durableEventPages({ ...input, progress }),
      streamTTLSeconds: input.streamTTLSeconds,
    });
  } catch (error) {
    input.logger.warn(
      `Turn stream restore failed (${restoreStats(progress, startedAt)})`,
      extractErrorLogFields(error),
    );
    throw error;
  }
  const stats = restoreStats(progress, startedAt);
  if (outcome === 'present') {
    // Paused resumes of a live stream are the common case; keep them out of info logs.
    input.logger.debug(`Turn stream present, TTL refreshed in ${String(elapsedMs(startedAt))}ms`);
  } else if (outcome === 'installed') {
    input.logger.info(`Turn stream restored from durable log (${stats})`);
  } else {
    input.logger.info(`Turn stream restore lost a race to another writer (${stats})`);
  }
}

/** One page in memory, in event-id order. */
async function* durableEventPages<TTransaction>(input: {
  sessionStore: Pick<ISessionStore<TTransaction>, 'listTurnEvents'>;
  logger: Logger;
  sessionId: string;
  turnId: string;
  progress: RestoreProgress;
}): AsyncGenerator<TurnStreamingEvent[]> {
  // Pages are requested only when the stream was absent at the tail check.
  input.logger.info('Turn stream missing, rebuilding from durable log');
  let pageToken: string | undefined;
  for (;;) {
    const queryStartedAt = performance.now();
    const page = await input.sessionStore.listTurnEvents({
      session_id: input.sessionId,
      turn_id: input.turnId,
      limit: RESTORE_PAGE_LIMIT,
      page_token: pageToken,
      order: 'asc',
    });
    const nextPageToken = page.pagination.next_page_token;
    input.progress.pages += 1;
    input.progress.events += page.data.length;
    const more = nextPageToken !== undefined ? ', more remain' : '';
    input.logger.info(
      `Turn stream restore page ${String(input.progress.pages)} queried ${String(page.data.length)} rows in ${String(elapsedMs(queryStartedAt))}ms${more}`,
    );
    yield page.data;
    if (nextPageToken === undefined) {
      return;
    }
    pageToken = nextPageToken;
  }
}

/** Counts and elapsed time, kept in the message so they are not indexed as fields. */
function restoreStats(progress: RestoreProgress, startedAt: number): string {
  return `${countLabel(progress.events, 'event')}, ${countLabel(progress.pages, 'page')}, ${String(elapsedMs(startedAt))}ms`;
}

function countLabel(count: number, singular: string): string {
  return `${String(count)} ${singular}${count === 1 ? '' : 's'}`;
}

/** Milliseconds with one decimal, for sub-millisecond queries. */
function elapsedMs(startedAt: number): number {
  return Math.round((performance.now() - startedAt) * 10) / 10;
}
