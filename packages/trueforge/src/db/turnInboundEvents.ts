import type { TurnUserEvent, TurnUserEventMessage } from '@truefoundry/trueforge-core/agent-session';
import type { InsertTurnInboundEventsInput } from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';

type InboundInsertEvent = InsertTurnInboundEventsInput['events'][number];

export function toTurnUserEventMessage(event: TurnUserEvent): TurnUserEventMessage {
  switch (event.type) {
    case 'user.tool_approval':
      return {
        type: event.type,
        thread_id: event.thread_id,
        tool_call_id: event.tool_call_id,
        approval: event.approval,
      };
    case 'user.tool_response':
      return {
        type: event.type,
        thread_id: event.thread_id,
        tool_call_id: event.tool_call_id,
        content: event.content,
      };
    case 'user.tool_approval_policy':
      return {
        type: event.type,
        policies: event.policies,
      };
    case 'user.mcp_auth_continue':
      return { type: event.type };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function toTurnUserEvent(row: {
  event_id: string;
  payload: TurnUserEventMessage;
  created_at: string;
}): TurnUserEvent {
  return {
    ...row.payload,
    id: row.event_id,
    created_at: row.created_at,
  };
}

/** First repeated event id in the batch (input order), if any. */
export function firstDuplicateEventIdInBatch(events: readonly Pick<InboundInsertEvent, 'id'>[]): string | undefined {
  const seen = new Set<string>();
  for (const event of events) {
    if (seen.has(event.id)) {
      return event.id;
    }
    seen.add(event.id);
  }
  return undefined;
}

/**
 * After a unique/PK violation, pick the colliding id: first input event id
 * that already exists.
 */
export function firstCollidingEventId(
  events: readonly Pick<InboundInsertEvent, 'id'>[],
  existingEventIds: ReadonlySet<string>,
): string {
  return events.find(e => existingEventIds.has(e.id))?.id ?? events[0]?.id ?? '';
}
