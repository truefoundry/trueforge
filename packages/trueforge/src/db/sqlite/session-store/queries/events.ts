import type { PersistedTurnEvent, SessionEventItem } from '@truefoundry/trueforge-core/agent-session/schemas/events';
import type { TokenPagination } from '@truefoundry/trueforge-core/agent-session/schemas/pagination';
import type {
  AppendToEventsInput,
  ListSessionEventsInput,
  ListTurnEventsInput,
} from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import {
  decodeSessionEventPageToken,
  paginateSessionEventRows,
  type SessionEventPageCursor,
} from '@truefoundry/trueforge-core/agent-session/store/SessionEventPageToken';
import {
  SessionNotFoundError,
  TurnNotFoundError,
} from '@truefoundry/trueforge-core/agent-session/store/SessionStoreErrors';
import { sql, type Kysely } from 'kysely';
import { jsonbBind, jsonText } from '../../sqlExpressions';
import type { Database } from '../../types';
import { classifyTurnFenceWriteFailure, type TurnKeys } from './turns';

export async function appendToEvents(db: Kysely<Database>, input: AppendToEventsInput): Promise<void> {
  if (input.events.length === 0) {
    return;
  }

  const keys: TurnKeys = {
    session_id: input.session_id,
    turn_id: input.turn_id,
  };

  // Fence check first inside BEGIN IMMEDIATE; then batched insert.
  await db.transaction().execute(async trx => {
    const fenceRow = await trx
      .selectFrom('turn')
      .select(sql`1`.as('one'))
      .where('session_id', '=', keys.session_id)
      .where('turn_id', '=', keys.turn_id)
      .where(sql<boolean>`state->>'status' = 'running'`)
      .executeTakeFirst();

    if (!fenceRow) {
      await classifyTurnFenceWriteFailure(trx, keys);
    }

    const eventRows = input.events.map(event => ({
      session_id: input.session_id,
      turn_id: input.turn_id,
      event_id: event.id,
      event: jsonbBind(event),
      created_at: event.created_at,
    }));

    await trx.insertInto('session_event').values(eventRows).execute();
  });
}

/**
 * listTurnEvents — one statement: drive from turn, left-join a page of events.
 * Missing turn → 0 rows → TurnNotFoundError. Empty log → one null-event sentinel.
 */
export async function listTurnEvents(
  db: Kysely<Database>,
  input: ListTurnEventsInput,
): Promise<{ data: PersistedTurnEvent[]; pagination: TokenPagination }> {
  const offset = decodeOffsetPageToken(input.page_token);
  const limit = input.limit;
  const eventOrder = input.order === 'desc' ? 'desc' : 'asc';

  const rows = await db
    .selectFrom('turn as t')
    .leftJoin(
      eb =>
        eb
          .selectFrom('session_event')
          .select(['session_id', 'turn_id', 'event_id', jsonText<PersistedTurnEvent>(sql.ref('event')).as('event')])
          .where('session_id', '=', input.session_id)
          .where('turn_id', '=', input.turn_id)
          .orderBy('event_id', eventOrder)
          .limit(limit + 1)
          .offset(offset)
          .as('e'),
      join => join.onRef('e.session_id', '=', 't.session_id').onRef('e.turn_id', '=', 't.turn_id'),
    )
    .select(['t.turn_id', 'e.event'])
    .where('t.session_id', '=', input.session_id)
    .where('t.turn_id', '=', input.turn_id)
    .orderBy('e.event_id', eventOrder)
    .execute();

  if (rows.length === 0) {
    throw new TurnNotFoundError(input.turn_id);
  }

  const events: PersistedTurnEvent[] = [];
  for (const row of rows) {
    if (row.event !== null) {
      events.push(row.event);
    }
  }

  return paginateOffsetRows(events, limit, offset);
}

/** Anchor turn fields needed for chain resolution. */
export interface AnchorTurn {
  turn_id: string;
  ancestor_ids: string[];
}

/**
 * Full chain (oldest first, anchor last). `ancestor_ids` may be only the
 * previous N ancestors, so spill through the oldest ancestor's own window
 * until a root or gap. A missing turn or repeated id ends the walk.
 */
export async function resolveAncestorChain(
  db: Kysely<Database>,
  sessionId: string,
  anchor: AnchorTurn,
): Promise<string[]> {
  const chain = [...anchor.ancestor_ids, anchor.turn_id];
  const seen = new Set(chain);
  let oldestId = chain[0];
  while (oldestId && oldestId !== anchor.turn_id) {
    const oldest = await db
      .selectFrom('turn')
      .select([jsonText<string[]>(sql.ref('ancestor_ids')).as('ancestor_ids')])
      .where('session_id', '=', sessionId)
      .where('turn_id', '=', oldestId)
      .executeTakeFirst();
    if (!oldest) {
      break;
    }
    const older = oldest.ancestor_ids.filter(id => !seen.has(id));
    if (older.length === 0) {
      break;
    }
    chain.unshift(...older);
    for (const id of older) {
      seen.add(id);
    }
    oldestId = older[0];
  }
  return chain;
}

export async function listSessionEvents(
  db: Kysely<Database>,
  input: ListSessionEventsInput,
): Promise<{ data: SessionEventItem[]; pagination: TokenPagination }> {
  const limit = input.limit;

  const session = await db
    .selectFrom('session')
    .select('last_turn_id')
    .where('session_id', '=', input.session_id)
    .executeTakeFirst();
  if (!session) {
    throw new SessionNotFoundError(input.session_id);
  }

  const decodedCursor = input.page_token === undefined ? undefined : decodeSessionEventPageToken(input.page_token);
  const lastTurnId = decodedCursor?.last_turn_id ?? input.last_turn_id ?? session.last_turn_id;
  if (lastTurnId === null) {
    return { data: [], pagination: { limit } };
  }
  const cursor: SessionEventPageCursor = {
    last_turn_id: lastTurnId,
    offset: decodedCursor?.offset ?? 0,
  };

  const anchor = await db
    .selectFrom('turn')
    .select(['turn_id', jsonText<string[]>(sql.ref('ancestor_ids')).as('ancestor_ids')])
    .where('session_id', '=', input.session_id)
    .where('turn_id', '=', cursor.last_turn_id)
    .executeTakeFirst();
  if (!anchor) {
    throw new TurnNotFoundError(cursor.last_turn_id);
  }

  const chainIds = await resolveAncestorChain(db, input.session_id, {
    turn_id: anchor.turn_id,
    ancestor_ids: anchor.ancestor_ids,
  });

  // Bind the ancestor chain as a JSON array; json_each gives (key=index, value=turn_id).
  const chainJson = JSON.stringify(chainIds);

  const rows = await db
    .selectFrom(sql<{ key: number; value: string }>`json_each(${chainJson})`.as('c'))
    .innerJoin('session_event as e', join =>
      join.on('e.session_id', '=', input.session_id).on(sql<boolean>`e.turn_id = c.value`),
    )
    .select([sql<string>`c.value`.as('turn_id'), jsonText<SessionEventItem['event']>(sql.ref('e.event')).as('event')])
    .orderBy(sql`c.key`, 'desc')
    .orderBy('e.event_id', 'desc')
    .limit(limit + 1)
    .offset(cursor.offset)
    .execute();

  return paginateSessionEventRows(rows, limit, cursor);
}
