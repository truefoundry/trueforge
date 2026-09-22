import type {
  InsertTurnInboundEventsInput,
  ListUnconsumedTurnInboundEventsInput,
  MarkTurnInboundEventsConsumedInput,
  TurnInboundEventRecord,
} from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import {
  SessionNotFoundError,
  TurnInboundEventAlreadyExistsError,
  TurnNotFoundError,
  TurnNotRunningError,
} from '@truefoundry/trueforge-core/agent-session/store/SessionStoreErrors';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import { firstCollidingEventId, firstDuplicateEventIdInBatch } from '../../../turnInboundEvents';
import { isUniqueViolation } from '../../client';
import { json } from '../../sqlExpressions';
import type { Database } from '../../types';

async function requireSession(db: Kysely<Database>, sessionId: string): Promise<void> {
  const row = await db
    .selectFrom('session')
    .select('session_id')
    .where('session_id', '=', sessionId)
    .executeTakeFirst();
  if (!row) {
    throw new SessionNotFoundError(sessionId);
  }
}

/** Exists + non-terminal (v1: `running` only; `paused` will be allowed when that status lands). */
async function requireTurn(db: Kysely<Database>, sessionId: string, turnId: string): Promise<void> {
  const row = await db
    .selectFrom('turn')
    .select(['turn_id', 'state'])
    .where('session_id', '=', sessionId)
    .where('turn_id', '=', turnId)
    .executeTakeFirst();
  if (!row) {
    throw new TurnNotFoundError(turnId);
  }
  if (row.state.status !== 'running') {
    throw new TurnNotRunningError(turnId, row.state);
  }
}

async function resolveCollidingEventId(
  db: Kysely<Database>,
  sessionId: string,
  turnId: string,
  events: InsertTurnInboundEventsInput['events'],
): Promise<string> {
  const ids = [...new Set(events.map(e => e.event_id))];
  if (ids.length === 0) {
    return '';
  }
  const rows = await db
    .selectFrom('turn_inbound_events')
    .select('event_id')
    .where('session_id', '=', sessionId)
    .where('turn_id', '=', turnId)
    .where('event_id', 'in', ids)
    .execute();
  return firstCollidingEventId(events, new Set(rows.map(r => r.event_id)));
}

export async function insertTurnInboundEvents(
  db: Kysely<Database>,
  input: InsertTurnInboundEventsInput,
): Promise<void> {
  if (input.events.length === 0) {
    return;
  }
  await requireSession(db, input.session_id);
  await requireTurn(db, input.session_id, input.turn_id);

  const duplicateInBatch = firstDuplicateEventIdInBatch(input.events);
  if (duplicateInBatch !== undefined) {
    throw new TurnInboundEventAlreadyExistsError(input.session_id, input.turn_id, duplicateInBatch);
  }

  try {
    await db
      .insertInto('turn_inbound_events')
      .values(
        input.events.map(event => ({
          session_id: input.session_id,
          turn_id: input.turn_id,
          event_id: event.event_id,
          payload: json(event.payload),
          consumed: false,
          created_at: sql<Date>`${event.created_at}::timestamptz`,
        })),
      )
      .execute();
  } catch (error) {
    if (isUniqueViolation(error)) {
      const eventId = await resolveCollidingEventId(db, input.session_id, input.turn_id, input.events);
      throw new TurnInboundEventAlreadyExistsError(input.session_id, input.turn_id, eventId, {
        cause: error,
      });
    }
    throw error;
  }
}

export async function listUnconsumedTurnInboundEvents(
  db: Kysely<Database>,
  input: ListUnconsumedTurnInboundEventsInput,
): Promise<TurnInboundEventRecord[]> {
  await requireSession(db, input.session_id);

  const rows = await db
    .selectFrom('turn_inbound_events')
    .select(['event_id', 'turn_id', 'payload', 'created_at'])
    .where('session_id', '=', input.session_id)
    .where('turn_id', '=', input.turn_id)
    .where('consumed', '=', false)
    .orderBy('event_id', 'asc')
    .execute();

  return rows.map(row => ({
    event_id: row.event_id,
    turn_id: row.turn_id,
    payload: row.payload,
    created_at: new Date(row.created_at).toISOString(),
  }));
}

export async function markTurnInboundEventsConsumed(
  db: Kysely<Database>,
  input: MarkTurnInboundEventsConsumedInput,
): Promise<void> {
  if (input.event_ids.length === 0) {
    return;
  }
  await requireSession(db, input.session_id);

  await db
    .updateTable('turn_inbound_events')
    .set({ consumed: true })
    .where('session_id', '=', input.session_id)
    .where('turn_id', '=', input.turn_id)
    .where('event_id', 'in', input.event_ids)
    .execute();
}
