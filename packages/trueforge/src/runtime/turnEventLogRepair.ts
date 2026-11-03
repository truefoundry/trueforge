import type { ISessionStore, TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session';
import type { EventSubscription } from './event-subscription';

/**
 * Rebuild a paused turn's live stream from the durable log.
 * Subscribe omits `producerExecutorId` and only appends.
 * The producing resume, which already owns the turn row, claims the stream-owner key.
 */
export async function repairTurnEventLog<TTransaction>(input: {
  sessionStore: Pick<ISessionStore<TTransaction>, 'listTurnEventLog'>;
  subscription: EventSubscription<TurnStreamingEvent>;
  sessionId: string;
  turnId: string;
  streamTTLSeconds: number;
  producerExecutorId?: string | undefined;
}): Promise<void> {
  const events = await input.sessionStore.listTurnEventLog({
    session_id: input.sessionId,
    turn_id: input.turnId,
  });
  await input.subscription.repairLog({
    entries: events.map(event => ({ id: event.id, event })),
    streamTTLSeconds: input.streamTTLSeconds,
    ...(input.producerExecutorId === undefined ? {} : { executorId: input.producerExecutorId }),
  });
}
