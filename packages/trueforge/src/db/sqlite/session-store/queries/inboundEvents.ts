import type { TurnUserEvent, TurnUserEventMessage } from '@truefoundry/trueforge-core/agent-session';
import type {
  InsertTurnInboundEventsInput,
  ListUnconsumedTurnInboundEventsInput,
  MarkTurnInboundEventsConsumedInput,
} from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import {
  SessionNotFoundError,
  SessionStoreInvariantError,
  TurnEventAlreadyExistsError,
} from '@truefoundry/trueforge-core/agent-session/store/SessionStoreErrors';
import { sql, type Kysely, type Transaction } from 'kysely';
import { firstDuplicate, firstValueInSet } from '../../../../utils/collections';
import { isTransaction } from '../../../transaction';
import { toTurnUserEvent, toTurnUserEventMessage } from '../../../turnInboundEvents';
import { isUniqueViolation } from '../../client';
import { jsonbBind, jsonText } from '../../sqlExpressions';
import type { Database } from '../../types';
import { assertOwnedNonTerminalTurn, assertTurnNonTerminal } from './turns';

type DbOrTrx = Kysely<Database> | Transaction<Database>;

async function requireSession(db: DbOrTrx, sessionId: string): Promise<void> {
  const row = await db
    .selectFrom('session')
    .select('session_id')
    .where('session_id', '=', sessionId)
    .executeTakeFirst();
  if (!row) {
    throw new SessionNotFoundError(sessionId);
  }
}

async function resolveCollidingEventId(
  db: Kysely<Database>,
  sessionId: string,
  turnId: string,
  events: InsertTurnInboundEventsInput['events'],
): Promise<string> {
  const ids = [...new Set(events.map(e => e.id))];
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
  return firstValueInSet(ids, new Set(rows.map(r => r.event_id))) ?? ids[0] ?? '';
}

export async function insertTurnInboundEvents(
  db: Kysely<Database>,
  input: InsertTurnInboundEventsInput,
): Promise<void> {
  if (input.events.length === 0) {
    return;
  }
  await requireSession(db, input.session_id);

  const duplicateInBatch = firstDuplicate(input.events.map(event => event.id));
  if (duplicateInBatch !== undefined) {
    throw new TurnEventAlreadyExistsError({
      session_id: input.session_id,
      turn_id: input.turn_id,
      event_id: duplicateInBatch,
    });
  }

  const keys = {
    session_id: input.session_id,
    turn_id: input.turn_id,
    active_executor_id: input.active_executor_id,
  };

  try {
    // The row must still be non-terminal and owned by this executor.
    await db.transaction().execute(async trx => {
      await assertOwnedNonTerminalTurn(trx, keys);
      await trx
        .insertInto('turn_inbound_events')
        .values(
          input.events.map(event => ({
            session_id: input.session_id,
            turn_id: input.turn_id,
            event_id: event.id,
            payload: jsonbBind(toTurnUserEventMessage(event)),
            consumed: 0,
            created_at: event.created_at,
          })),
        )
        .execute();
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const eventId = await resolveCollidingEventId(db, input.session_id, input.turn_id, input.events);
      throw new TurnEventAlreadyExistsError(
        {
          session_id: input.session_id,
          turn_id: input.turn_id,
          event_id: eventId,
        },
        { cause: error },
      );
    }
    throw error;
  }
}

export async function listUnconsumedTurnInboundEvents(
  db: Kysely<Database>,
  input: ListUnconsumedTurnInboundEventsInput,
): Promise<TurnUserEvent[]> {
  await requireSession(db, input.session_id);
  await assertTurnNonTerminal(db, {
    session_id: input.session_id,
    turn_id: input.turn_id,
  });

  const rows = await db
    .selectFrom('turn_inbound_events')
    .select(['event_id', jsonText<TurnUserEventMessage>(sql.ref('payload')).as('payload'), 'created_at'])
    .where('session_id', '=', input.session_id)
    .where('turn_id', '=', input.turn_id)
    .where('consumed', '=', 0)
    .orderBy('event_id', 'asc')
    .execute();

  return rows.map(row => toTurnUserEvent(row));
}

export async function markTurnInboundEventsConsumed(
  db: DbOrTrx,
  input: MarkTurnInboundEventsConsumedInput,
): Promise<void> {
  if (isTransaction<Database>(db)) {
    await markTurnInboundEventsConsumedInTransaction(db, input);
    return;
  }
  await db.transaction().execute(trx => markTurnInboundEventsConsumedInTransaction(trx, input));
}

async function markTurnInboundEventsConsumedInTransaction(
  db: Transaction<Database>,
  input: MarkTurnInboundEventsConsumedInput,
): Promise<void> {
  if (input.event_ids.length === 0) {
    return;
  }
  await requireSession(db, input.session_id);

  const uniqueIds = [...new Set(input.event_ids)];
  const keys = { session_id: input.session_id, turn_id: input.turn_id };

  await assertTurnNonTerminal(db, keys);
  const existing = await db
    .selectFrom('turn_inbound_events')
    .select('event_id')
    .where('session_id', '=', input.session_id)
    .where('turn_id', '=', input.turn_id)
    .where('event_id', 'in', uniqueIds)
    .execute();
  const found = new Set(existing.map(row => row.event_id));
  for (const eventId of uniqueIds) {
    if (!found.has(eventId)) {
      throw new SessionStoreInvariantError(
        `Inbound event not found for mark-consumed: ${input.session_id}/${input.turn_id}/${eventId}`,
      );
    }
  }
  await db
    .updateTable('turn_inbound_events')
    .set({ consumed: 1 })
    .where('session_id', '=', input.session_id)
    .where('turn_id', '=', input.turn_id)
    .where('event_id', 'in', uniqueIds)
    .execute();
}
