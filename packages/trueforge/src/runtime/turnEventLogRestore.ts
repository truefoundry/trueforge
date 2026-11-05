import type { ISessionStore, TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session';
import type { EventSubscription } from './event-subscription';

/** Large pages keep a full restore to few round trips. */
const RESTORE_PAGE_LIMIT = 1_000;

/**
 * Restore a paused turn's live stream from the durable log when the stream is gone.
 * An existing stream is never patched: persist order can differ from emit order.
 */
export async function restoreTurnEventLog<TTransaction>(input: {
  sessionStore: Pick<ISessionStore<TTransaction>, 'listTurnEvents'>;
  subscription: EventSubscription<TurnStreamingEvent>;
  sessionId: string;
  turnId: string;
  streamTTLSeconds: number;
}): Promise<void> {
  await input.subscription.restoreLog({
    readPages: () => durableEventPages(input),
    streamTTLSeconds: input.streamTTLSeconds,
  });
}

/** One page in memory, in event-id order. */
async function* durableEventPages<TTransaction>(input: {
  sessionStore: Pick<ISessionStore<TTransaction>, 'listTurnEvents'>;
  sessionId: string;
  turnId: string;
}): AsyncGenerator<TurnStreamingEvent[]> {
  let pageToken: string | undefined;
  for (;;) {
    const page = await input.sessionStore.listTurnEvents({
      session_id: input.sessionId,
      turn_id: input.turnId,
      limit: RESTORE_PAGE_LIMIT,
      page_token: pageToken,
      order: 'asc',
    });
    yield page.data;
    const nextPageToken = page.pagination.next_page_token;
    if (nextPageToken === undefined) {
      return;
    }
    pageToken = nextPageToken;
  }
}
