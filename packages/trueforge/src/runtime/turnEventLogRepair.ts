import type { ISessionStore, TurnStreamingEvent } from '@truefoundry/trueforge-core/agent-session';
import type { EventLogEntry, EventSubscription } from './event-subscription';

/**
 * Rebuild a paused turn's live stream from the durable log.
 * Subscribe omits `producerExecutorId` and only appends.
 * The producing resume claims the stream-owner key. Rows are appended with the
 * same event-id stream ids as a live put.
 */
export async function repairTurnEventLog<TTransaction>(input: {
  sessionStore: Pick<ISessionStore<TTransaction>, 'listTurnEventLog' | 'assignTurnEventSequenceNumbers'>;
  subscription: EventSubscription<TurnStreamingEvent>;
  sessionId: string;
  turnId: string;
  streamTTLSeconds: number;
  producerExecutorId?: string | undefined;
}): Promise<void> {
  const rows = await input.sessionStore.listTurnEventLog({
    session_id: input.sessionId,
    turn_id: input.turnId,
  });
  const entries: EventLogEntry<TurnStreamingEvent>[] = rows.map(row => ({
    id: row.event.id,
    event: row.event,
  }));
  const producerExecutorId = input.producerExecutorId;
  if (producerExecutorId !== undefined) {
    // Empty assignment still takes the turn-owner fence. It does not write sequence numbers.
    await input.sessionStore.assignTurnEventSequenceNumbers({
      session_id: input.sessionId,
      turn_id: input.turnId,
      active_executor_id: producerExecutorId,
      assignments: [],
    });
  }
  await input.subscription.repairLog({
    entries,
    streamTTLSeconds: input.streamTTLSeconds,
    ...(producerExecutorId === undefined ? {} : { executorId: producerExecutorId }),
  });
}
