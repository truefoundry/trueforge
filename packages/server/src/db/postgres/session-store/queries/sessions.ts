import type { AgentSpec } from '@truefoundry/utils-core/agent-session';
import type { SessionRecord } from '@truefoundry/utils-core/agent-session/models/SessionRecord';
import type {
  CreateSessionInput,
  DeleteSessionInput,
  GetSessionInput,
  ListSessionsInput,
  UpdateSessionInput,
} from '@truefoundry/utils-core/agent-session/store/ISessionStore';
import { decodeOffsetPageToken, paginateOffsetRows } from '@truefoundry/utils-core/agent-session/store/OffsetPageToken';
import {
  SessionAlreadyExistsError,
  SessionNotFoundError,
  SessionStoreInvariantError,
} from '@truefoundry/utils-core/agent-session/store/SessionStoreErrors';
import { sql, type Kysely } from 'kysely';
import { sessionAgentFromColumns, sessionAgentToColumns } from '../../../sessionAgentColumns';
import { json } from '../../sqlExpressions';
import type { Database } from '../../types';

function isPgUniqueViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if (!('code' in error)) {
    return false;
  }
  return error.code === '23505';
}

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
  created_by: string;
  agent_id: string | null;
  agent_spec: AgentSpec | null;
  title: string | null;
  last_turn_id: string | null;
  custom: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
  last_activity_timestamp_ms: number;
}): ProtoSessionRecord {
  return {
    tenant_id: row.tenant_id,
    session_id: row.session_id,
    created_by: row.created_by,
    agent: sessionAgentFromColumns({
      session_id: row.session_id,
      agent_id: row.agent_id,
      agent_spec: row.agent_spec,
    }),
    title: row.title,
    last_turn_id: row.last_turn_id,
    custom: parseSessionCustom(row.custom),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_activity_timestamp_ms: row.last_activity_timestamp_ms,
  };
}

export async function createSession(db: Kysely<Database>, input: CreateSessionInput<SessionCustom>): Promise<void> {
  const columns = sessionAgentToColumns(input.agent);
  const nowMs = Date.now();

  try {
    await db
      .insertInto('session')
      .values({
        tenant_id: input.tenant_id,
        session_id: input.session_id,
        created_by: input.created_by,
        agent_id: columns.agent_id,
        agent_spec: columns.agent_spec !== null ? json(columns.agent_spec) : null,
        title: null,
        custom: input.custom !== null ? json(input.custom) : null,
        created_at: new Date(nowMs),
        updated_at: new Date(nowMs),
        last_activity_timestamp_ms: nowMs,
      })
      .execute();
  } catch (error) {
    if (isPgUniqueViolation(error)) {
      throw new SessionAlreadyExistsError(input.session_id);
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
    .selectAll()
    .where('tenant_id', '=', input.tenant_id)
    .where('session_id', '=', input.session_id)
    .executeTakeFirst();

  if (row === undefined) {
    return undefined;
  }

  return mapRowToSessionRecord(row);
}

export async function updateSession(db: Kysely<Database>, input: UpdateSessionInput<SessionCustom>): Promise<void> {
  const agent = input.agent;
  const title = input.title;

  if (agent !== undefined) {
    const existing = await getSession(db, { tenant_id: input.tenant_id, session_id: input.session_id });
    if (existing === undefined) {
      throw new SessionNotFoundError(input.session_id);
    }
    if (existing.agent.type === 'ref') {
      throw new SessionStoreInvariantError(`Session ${input.session_id} is named; agent cannot be updated`);
    }
  }

  const result = await db
    .updateTable('session')
    .set({
      updated_at: sql<Date>`now()`,
      last_activity_timestamp_ms: Date.now(),
    })
    .$if(agent !== undefined, qb => {
      if (agent === undefined) {
        return qb;
      }
      return qb.set({ agent_spec: json(agent.agent_spec) });
    })
    .$if(title !== undefined, qb => {
      if (title === undefined) {
        return qb;
      }
      return qb.set({ title });
    })
    .where('tenant_id', '=', input.tenant_id)
    .where('session_id', '=', input.session_id)
    .executeTakeFirst();

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

  let query = db.selectFrom('session').selectAll().where('tenant_id', '=', input.tenant_id);

  if (input.agent_id !== undefined) {
    query = query.where('agent_id', '=', input.agent_id);
  }
  if (input.created_by !== undefined) {
    query = query.where('created_by', '=', input.created_by);
  }
  if (input.start_timestamp !== undefined) {
    query = query.where('created_at', '>=', input.start_timestamp);
  }
  if (input.end_timestamp !== undefined) {
    query = query.where('created_at', '<=', input.end_timestamp);
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
