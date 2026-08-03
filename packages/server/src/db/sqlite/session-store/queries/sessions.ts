import type { AgentSpec } from '@truefoundry/utils/agent-session';
import type { SessionRecord } from '@truefoundry/utils/agent-session/models/SessionRecord';
import type {
  CreateSessionInput,
  DeleteSessionInput,
  GetSessionInput,
  ListSessionsInput,
  UpdateSessionInput,
} from '@truefoundry/utils/agent-session/store/ISessionStore';
import { decodeOffsetPageToken, paginateOffsetRows } from '@truefoundry/utils/agent-session/store/OffsetPageToken';
import {
  SessionAlreadyExistsError,
  SessionNotFoundError,
  SessionStoreInvariantError,
} from '@truefoundry/utils/agent-session/store/SessionStoreErrors';
import { sql, type Kysely } from 'kysely';
import { isUniqueViolation } from '../../client';
import { jsonbBind, jsonText, nowIso } from '../../sqlExpressions';
import type { Database } from '../../types';

type SessionCustom = Record<string, never>;
type ProtoSessionRecord = SessionRecord<SessionCustom>;

function isEmptyCustomRecord(value: Record<string, unknown>): value is SessionCustom {
  return Object.keys(value).length === 0;
}

function parseSessionCustom(value: Record<string, unknown> | null): SessionCustom | null {
  if (value === null) {
    return null;
  }
  if (!isEmptyCustomRecord(value)) {
    throw new SessionStoreInvariantError('non-empty session custom is not supported');
  }
  return value;
}

function mapRowToSessionRecord(row: {
  tenant_id: string;
  session_id: string;
  agent_spec: AgentSpec;
  title: string | null;
  last_turn_id: string | null;
  custom: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  last_activity_timestamp_ms: number;
}): ProtoSessionRecord {
  return {
    tenant_id: row.tenant_id,
    session_id: row.session_id,
    agent_spec: row.agent_spec,
    title: row.title,
    last_turn_id: row.last_turn_id,
    custom: parseSessionCustom(row.custom),
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    last_activity_timestamp_ms: row.last_activity_timestamp_ms,
  };
}

export async function createSession(db: Kysely<Database>, input: CreateSessionInput<SessionCustom>): Promise<void> {
  const now = nowIso();

  try {
    await db
      .insertInto('session')
      .values({
        tenant_id: input.tenant_id,
        session_id: input.session_id,
        agent_spec: jsonbBind(input.agent_spec),
        title: null,
        custom: input.custom !== null ? jsonbBind(input.custom) : null,
        created_at: now,
        updated_at: now,
        last_activity_timestamp_ms: Date.now(),
      })
      .execute();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new SessionAlreadyExistsError(input.session_id, { cause: error });
    }
    throw error;
  }
}

export async function deleteSession(db: Kysely<Database>, input: DeleteSessionInput): Promise<void> {
  await db
    .deleteFrom('session')
    .where('tenant_id', '=', input.tenant_id)
    .where('session_id', '=', input.session_id)
    .execute();
}

export async function getSession(
  db: Kysely<Database>,
  input: GetSessionInput,
): Promise<ProtoSessionRecord | undefined> {
  const row = await db
    .selectFrom('session')
    .select([
      'tenant_id',
      'session_id',
      jsonText<AgentSpec>(sql.ref('agent_spec')).as('agent_spec'),
      'title',
      'last_turn_id',
      jsonText<Record<string, unknown> | null>(sql.ref('custom')).as('custom'),
      'created_at',
      'updated_at',
      'last_activity_timestamp_ms',
    ])
    .where('tenant_id', '=', input.tenant_id)
    .where('session_id', '=', input.session_id)
    .executeTakeFirst();

  if (row === undefined) {
    return undefined;
  }

  return mapRowToSessionRecord(row);
}

export async function updateSession(db: Kysely<Database>, input: UpdateSessionInput<SessionCustom>): Promise<void> {
  const agentSpec = input.agent_spec;
  const title = input.title;

  let qb = db
    .updateTable('session')
    .set({
      updated_at: nowIso(),
      last_activity_timestamp_ms: Date.now(),
    })
    .where('tenant_id', '=', input.tenant_id)
    .where('session_id', '=', input.session_id);

  if (agentSpec !== undefined) {
    qb = qb.set({ agent_spec: jsonbBind(agentSpec) });
  }
  if (title !== undefined) {
    qb = qb.set({ title });
  }

  const result = await qb.executeTakeFirst();

  const numUpdatedRows = Number(result.numUpdatedRows);
  if (numUpdatedRows === 0) {
    throw new SessionNotFoundError(input.session_id);
  }
}

export async function listSessions(
  db: Kysely<Database>,
  input: ListSessionsInput,
): Promise<{
  data: ProtoSessionRecord[];
  pagination: { next_page_token?: string | undefined; previous_page_token?: string | undefined };
}> {
  const limit = input.limit;
  const offset = decodeOffsetPageToken(input.page_token);
  const order = input.order ?? 'desc';

  let query = db
    .selectFrom('session')
    .select([
      'tenant_id',
      'session_id',
      jsonText<AgentSpec>(sql.ref('agent_spec')).as('agent_spec'),
      'title',
      'last_turn_id',
      jsonText<Record<string, unknown> | null>(sql.ref('custom')).as('custom'),
      'created_at',
      'updated_at',
      'last_activity_timestamp_ms',
    ])
    .where('tenant_id', '=', input.tenant_id);

  if (input.start_timestamp !== undefined) {
    query = query.where('created_at', '>=', input.start_timestamp.toISOString());
  }
  if (input.end_timestamp !== undefined) {
    query = query.where('created_at', '<=', input.end_timestamp.toISOString());
  }

  if (order === 'asc') {
    query = query.orderBy('created_at', 'asc').orderBy('session_id', 'asc');
  } else {
    query = query.orderBy('created_at', 'desc').orderBy('session_id', 'desc');
  }

  const rows = await query
    .limit(limit + 1)
    .offset(offset)
    .execute();

  const { data, pagination } = paginateOffsetRows(rows, limit, offset);

  return {
    data: data.map(mapRowToSessionRecord),
    pagination,
  };
}
