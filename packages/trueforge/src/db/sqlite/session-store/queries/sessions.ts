import type {
  AgentSpec,
  CreatedBySubject,
  SessionMetadata,
  SessionMetrics,
} from '@truefoundry/trueforge-core/agent-session';
import { SessionMetadataSchema } from '@truefoundry/trueforge-core/agent-session';
import type { SessionRecord } from '@truefoundry/trueforge-core/agent-session/models/SessionRecord';
import type {
  CreateSessionInput,
  DeleteSessionInput,
  GetSessionByExternalIdInput,
  GetSessionInput,
  ListSessionsInput,
  UpdateSessionInput,
} from '@truefoundry/trueforge-core/agent-session/store/ISessionStore';
import {
  decodeSessionListPageToken,
  paginateSessionListRows,
} from '@truefoundry/trueforge-core/agent-session/store/SessionListPageToken';
import {
  SessionAlreadyExistsError,
  SessionExternalIdConflictError,
  SessionNotFoundError,
  SessionStoreInvariantError,
} from '@truefoundry/trueforge-core/agent-session/store/SessionStoreErrors';
import { sql, type Kysely } from 'kysely';
import { parseStoredCreatedBySubject } from '../../../createdBySubject';
import { sessionAgentFromColumns, sessionAgentToColumns } from '../../../sessionAgentColumns';
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

function parseSessionMetadata(value: unknown): SessionMetadata {
  return SessionMetadataSchema.parse(value);
}

function mapRowToSessionRecord(row: {
  tenant_id: string;
  session_id: string;
  created_by_subject: CreatedBySubject;
  agent_id: string | null;
  agent_name: string | null;
  agent_spec: AgentSpec | null;
  title: string | null;
  last_turn_id: string | null;
  external_id: string | null;
  custom: Record<string, unknown> | null;
  metadata: SessionMetadata;
  metrics: SessionMetrics;
  created_at: string;
  updated_at: string;
  last_activity_timestamp_ms: number;
}): ProtoSessionRecord {
  return {
    tenant_id: row.tenant_id,
    session_id: row.session_id,
    created_by_subject: parseStoredCreatedBySubject(row.created_by_subject),
    agent: sessionAgentFromColumns({
      session_id: row.session_id,
      agent_id: row.agent_id,
      agent_name: row.agent_name,
      agent_spec: row.agent_spec,
    }),
    title: row.title,
    last_turn_id: row.last_turn_id,
    external_id: row.external_id,
    custom: parseSessionCustom(row.custom),
    metadata: parseSessionMetadata(row.metadata),
    metrics: row.metrics,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    last_activity_timestamp_ms: row.last_activity_timestamp_ms,
  };
}

function sessionSelectColumns() {
  return [
    'tenant_id' as const,
    'session_id' as const,
    jsonText<CreatedBySubject>(sql.ref('created_by_subject')).as('created_by_subject'),
    'agent_id' as const,
    'agent_name' as const,
    jsonText<AgentSpec | null>(sql.ref('agent_spec')).as('agent_spec'),
    'title' as const,
    'last_turn_id' as const,
    'external_id' as const,
    jsonText<Record<string, unknown> | null>(sql.ref('custom')).as('custom'),
    jsonText<SessionMetadata>(sql.ref('metadata')).as('metadata'),
    jsonText<SessionMetrics>(sql.ref('metrics')).as('metrics'),
    'created_at' as const,
    'updated_at' as const,
    'last_activity_timestamp_ms' as const,
  ];
}

export async function createSession(db: Kysely<Database>, input: CreateSessionInput<SessionCustom>): Promise<void> {
  const columns = sessionAgentToColumns(input.agent);
  const now = nowIso();

  try {
    await db
      .insertInto('session')
      .values({
        tenant_id: input.tenant_id,
        session_id: input.session_id,
        created_by_subject: jsonbBind(input.created_by_subject),
        agent_id: columns.agent_id,
        agent_name: columns.agent_name,
        agent_spec: columns.agent_spec !== null ? jsonbBind(columns.agent_spec) : null,
        title: null,
        custom: input.custom !== null ? jsonbBind(input.custom) : null,
        metadata: jsonbBind(input.metadata),
        external_id: input.external_id,
        metrics: jsonbBind({
          total_cost_in_usd: 0,
          total_duration_ms: 0,
          total_turns: 0,
        }),
        created_at: now,
        updated_at: now,
        last_activity_timestamp_ms: Date.now(),
      })
      .execute();
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Which index fired is resolved by lookup, not by parsing the driver
      // message: SQLite describes a partial unique index by column list or by
      // index name depending on version. The failed INSERT already rolled back,
      // so a hit here is the pre-existing row that owns this external id.
      if (input.external_id !== null) {
        const owner = await getSessionByExternalId(db, {
          tenant_id: input.tenant_id,
          external_id: input.external_id,
        });
        if (owner !== undefined) {
          throw new SessionExternalIdConflictError(input.external_id, { cause: error });
        }
      }
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
    .select(sessionSelectColumns)
    .where('tenant_id', '=', input.tenant_id)
    .where('session_id', '=', input.session_id)
    .executeTakeFirst();

  if (row === undefined) {
    return undefined;
  }

  return mapRowToSessionRecord(row);
}

export async function getSessionByExternalId(
  db: Kysely<Database>,
  input: GetSessionByExternalIdInput,
): Promise<ProtoSessionRecord | undefined> {
  const row = await db
    .selectFrom('session')
    .select(sessionSelectColumns)
    .where('tenant_id', '=', input.tenant_id)
    .where('external_id', '=', input.external_id)
    .executeTakeFirst();

  if (row === undefined) {
    return undefined;
  }

  return mapRowToSessionRecord(row);
}

export async function updateSession(db: Kysely<Database>, input: UpdateSessionInput<SessionCustom>): Promise<void> {
  const agent = input.agent;
  const title = input.title;
  const metadata = input.metadata;

  if (agent !== undefined) {
    const existing = await getSession(db, { tenant_id: input.tenant_id, session_id: input.session_id });
    if (existing === undefined) {
      throw new SessionNotFoundError(input.session_id);
    }
    if (existing.agent.type === 'reference') {
      throw new SessionStoreInvariantError(`Session ${input.session_id} is named; agent cannot be updated`);
    }
  }

  let qb = db
    .updateTable('session')
    .set({
      updated_at: nowIso(),
      last_activity_timestamp_ms: Date.now(),
    })
    .where('tenant_id', '=', input.tenant_id)
    .where('session_id', '=', input.session_id);

  if (agent !== undefined) {
    qb = qb.set({ agent_spec: jsonbBind(agent.spec) });
  }
  if (title !== undefined) {
    qb = qb.set({ title });
  }
  if (metadata !== undefined) {
    qb = qb.set({ metadata: jsonbBind(metadata) });
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
  const order = input.order ?? 'desc';
  const cursor = decodeSessionListPageToken(input.page_token);

  let query = db.selectFrom('session').select(sessionSelectColumns).where('tenant_id', '=', input.tenant_id);

  if (input.agent_id !== undefined) {
    query = query.where('agent_id', '=', input.agent_id);
  }
  if (input.created_by_subject_id !== undefined) {
    query = query.where(sql`json_extract(created_by_subject, '$.subject_id')`, '=', input.created_by_subject_id);
  }
  if (input.start_timestamp !== undefined) {
    query = query.where('created_at', '>=', input.start_timestamp.toISOString());
  }
  if (input.end_timestamp !== undefined) {
    query = query.where('created_at', '<=', input.end_timestamp.toISOString());
  }

  if (cursor) {
    const cursorUpdatedAt = cursor.updated_at;
    const sessionId = cursor.session_id;
    if (order === 'asc') {
      query = query.where(eb =>
        eb.or([
          eb('updated_at', '>', cursorUpdatedAt),
          eb.and([eb('updated_at', '=', cursorUpdatedAt), eb('session_id', '>', sessionId)]),
        ]),
      );
    } else {
      query = query.where(eb =>
        eb.or([
          eb('updated_at', '<', cursorUpdatedAt),
          eb.and([eb('updated_at', '=', cursorUpdatedAt), eb('session_id', '<', sessionId)]),
        ]),
      );
    }
  }

  if (order === 'asc') {
    query = query.orderBy('updated_at', 'asc').orderBy('session_id', 'asc');
  } else {
    query = query.orderBy('updated_at', 'desc').orderBy('session_id', 'desc');
  }

  const rows = await query.limit(limit + 1).execute();
  // SQLite stores updated_at as ISO text already — use it directly for the keyset cursor.
  const { data: pageRows, pagination } = paginateSessionListRows(rows, limit, row => row.updated_at);

  return { data: pageRows.map(mapRowToSessionRecord), pagination };
}
