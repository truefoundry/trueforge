import type { ISessionStore, TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session';
import { EVENTS_PAGE_LIMIT } from '../schemas/common';
import type { EventSubscription } from './event-subscription';

/**
 * Rebuild a paused turn's live stream from the durable log.
 * Subscribe omits `producerExecutorId` and only appends.
 * The producing resume, which already owns the turn row, claims the stream-owner key.
 * Pages are read ascending so an empty stream is appended from start to end.
 */
export async function repairTurnEventLog<TTransaction>(input: {
  sessionStore: Pick<ISessionStore<TTransaction>, 'listTurnEvents'>;
  subscription: EventSubscription<TurnStreamingEvent>;
  sessionId: string;
  turnId: string;
  streamTTLSeconds: number;
  producerExecutorId?: string | undefined;
}): Promise<void> {
  await input.subscription.repairLog({
    readPages: () => durableEventPages(input),
    streamTTLSeconds: input.streamTTLSeconds,
    ...(input.producerExecutorId === undefined ? {} : { executorId: input.producerExecutorId }),
  });
}

/** One page in memory. `order: 'asc'` is persist order, which is also append order. */
async function* durableEventPages<TTransaction>(input: {
  sessionStore: Pick<ISessionStore<TTransaction>, 'listTurnEvents'>;
  sessionId: string;
  turnId: string;
}): AsyncGenerator<{ id: string; event: TurnStreamingEvent }[]> {
  let pageToken: string | undefined;
  for (;;) {
    const page = await input.sessionStore.listTurnEvents({
      session_id: input.sessionId,
      turn_id: input.turnId,
      limit: EVENTS_PAGE_LIMIT,
      page_token: pageToken,
      order: 'asc',
    });
    yield page.data.map(event => ({ id: event.id, event }));
    const nextPageToken = page.pagination.next_page_token;
    if (nextPageToken === undefined) {
      return;
    }
    pageToken = nextPageToken;
  }
}
