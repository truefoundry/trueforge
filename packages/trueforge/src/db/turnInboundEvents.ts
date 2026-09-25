import type { InsertTurnInboundEventsInput } from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';

type InboundInsertEvent = InsertTurnInboundEventsInput['events'][number];

/** First repeated `event_id` in the batch (input order), if any. */
export function firstDuplicateEventIdInBatch(
  events: readonly Pick<InboundInsertEvent, 'event_id'>[],
): string | undefined {
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.event_id)) {
      return event.event_id;
    }
    seen.add(event.event_id);
  }
  return undefined;
}

/**
 * After a unique/PK violation, pick the colliding id: first input `event_id`
 * that already exists.
 */
export function firstCollidingEventId(
  events: readonly Pick<InboundInsertEvent, 'event_id'>[],
  existingEventIds: ReadonlySet<string>,
): string {
  return events.find(e => existingEventIds.has(e.event_id))?.event_id ?? events[0]?.event_id ?? '';
}
