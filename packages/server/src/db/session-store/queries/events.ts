import type { PersistedTurnEvent, SessionEventItem } from '@truefoundry/utils/agent-session/schemas/events';
import type { TokenPagination } from '@truefoundry/utils/agent-session/schemas/pagination';
import type {
  AppendToEventsInput,
  ListSessionEventsInput,
  ListTurnEventsInput,
} from '@truefoundry/utils/agent-session/store/ISessionStore';
import { decodeOffsetPageToken, paginateOffsetRows } from '@truefoundry/utils/agent-session/store/OffsetPageToken';
import {
  decodeSessionEventPageToken,
  paginateSessionEventRows,
  type SessionEventPageCursor,
} from '@truefoundry/utils/agent-session/store/SessionEventPageToken';
import { SessionNotFoundError, TurnNotFoundError } from '@truefoundry/utils/agent-session/store/SessionStoreErrors';
import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { Database } from '../../types';
import { json, unnestWithOrdinality, values } from '../sqlExpressions';
import { classifyTurnFenceWriteFailure, turnRunningFence } from './turns';

export async function appendToEvents(db: Kysely<Database>, input: AppendToEventsInput): Promise<void> {
  if (input.events.length === 0) return;

  const keys = {
    tenant_id: input.tenant_id,
    session_id: input.session_id,
    turn_id: input.turn_id,
  };

  const eventRows = input.events.map(event => ({
    event_id: event.id,
    event: json(event),
    // VALUES parameters default to text; cast the event's required timestamp.
    created_at: sql<Date>`${event.created_at}::timestamptz`,
  }));

  const inserted = await db
    .with('turn_fence', qb => turnRunningFence(qb, keys))
    .insertInto('session_event')
    .columns(['tenant_id', 'session_id', 'turn_id', 'event_id', 'event', 'created_at'])
    .expression(eb =>
      eb
        .selectFrom(values(eventRows, 'ev'))
        .select([
          sql<string>`${input.tenant_id}`.as('tenant_id'),
          sql<string>`${input.session_id}`.as('session_id'),
          sql<string>`${input.turn_id}`.as('turn_id'),
          'ev.event_id',
          'ev.event',
          'ev.created_at',
        ])
        .where(wb => wb.exists(wb.selectFrom('turn_fence').select(sql`1`.as('one')))),
    )
    .returning('event_id')
    .execute();

  if (inserted.length === 0) {
    await classifyTurnFenceWriteFailure(db, keys);
  }
}

export async function listTurnEvents(
  db: Kysely<Database>,
  input: ListTurnEventsInput,
): Promise<{ data: PersistedTurnEvent[]; pagination: TokenPagination }> {
  const offset = decodeOffsetPageToken(input.page_token);
  const limit = input.limit;
  const order = input.order ?? 'asc';

  const turnExists = await db
    .selectFrom('turn')
    .select('turn_id')
    .where('tenant_id', '=', input.tenant_id)
    .where('session_id', '=', input.session_id)
    .where('turn_id', '=', input.turn_id)
    .executeTakeFirst();
  if (!turnExists) {
    throw new TurnNotFoundError(input.turn_id);
  }

  const query = db
    .selectFrom('session_event')
    .select(['event'])
    .where('tenant_id', '=', input.tenant_id)
    .where('session_id', '=', input.session_id)
    .where('turn_id', '=', input.turn_id)
    .orderBy('event_id', order === 'desc' ? 'desc' : 'asc')
    .limit(limit + 1)
    .offset(offset);

  const rows = await query.execute();
  const page = paginateOffsetRows(
    rows.map(r => r.event),
    limit,
    offset,
  );
  return page;
}

export async function listSessionEvents(
  db: Kysely<Database>,
  input: ListSessionEventsInput,
): Promise<{ data: SessionEventItem[]; pagination: TokenPagination }> {
  const limit = input.limit;

  const session = await db
    .selectFrom('session')
    .select('last_turn_id')
    .where('tenant_id', '=', input.tenant_id)
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
    .select(['turn_id', 'ancestor_ids'])
    .where('tenant_id', '=', input.tenant_id)
    .where('session_id', '=', input.session_id)
    .where('turn_id', '=', cursor.last_turn_id)
    .executeTakeFirst();
  if (!anchor) {
    throw new TurnNotFoundError(cursor.last_turn_id);
  }

  const chainIds = await resolveAncestorChain(db, input.tenant_id, input.session_id, anchor);
  const rows = await db
    .selectFrom(unnestWithOrdinality(chainIds, 'c'))
    .innerJoin('session_event as e', join =>
      join
        .on('e.tenant_id', '=', input.tenant_id)
        .on('e.session_id', '=', input.session_id)
        .onRef('e.turn_id', '=', 'c.turn_id'),
    )
    .select(['e.turn_id as turn_id', 'e.event as event'])
    .orderBy('c.pos', 'desc')
    .orderBy('e.event_id', 'desc')
    .limit(limit + 1)
    .offset(cursor.offset)
    .execute();

  return paginateSessionEventRows(rows, limit, cursor);
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
  tenant: string,
  sessionId: string,
  anchor: AnchorTurn,
): Promise<string[]> {
  const chain = [...anchor.ancestor_ids, anchor.turn_id];
  const seen = new Set(chain);
  let oldestId = chain[0];
  while (oldestId && oldestId !== anchor.turn_id) {
    const oldest = await db
      .selectFrom('turn')
      .select(['ancestor_ids'])
      .where('tenant_id', '=', tenant)
      .where('session_id', '=', sessionId)
      .where('turn_id', '=', oldestId)
      .executeTakeFirst();
    if (!oldest) break;
    const older = oldest.ancestor_ids.filter(id => !seen.has(id));
    if (older.length === 0) break;
    chain.unshift(...older);
    for (const id of older) seen.add(id);
    oldestId = older[0];
  }
  return chain;
}
