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
import { SESSION_EXTERNAL_ID_UQ } from '../../../indexes';
import { sessionAgentFromColumns, sessionAgentToColumns } from '../../../sessionAgentColumns';
import { isPgConstraint, isUniqueViolation } from '../../client';
import { json } from '../../sqlExpressions';
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
  created_at: Date;
  updated_at: Date;
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
        created_by_subject: json(input.created_by_subject),
        agent_id: columns.agent_id,
        agent_name: columns.agent_name,
        agent_spec: columns.agent_spec !== null ? json(columns.agent_spec) : null,
        title: null,
        custom: input.custom !== null ? json(input.custom) : null,
        metadata: json(input.metadata),
        external_id: input.external_id,
        metrics: json({
          total_cost_in_usd: 0,
          total_duration_ms: 0,
          total_turns: 0,
        }),
        created_at: new Date(nowMs),
        updated_at: new Date(nowMs),
        last_activity_timestamp_ms: nowMs,
      })
      .execute();
  } catch (error) {
    if (isUniqueViolation(error)) {
      if (isPgConstraint(error, SESSION_EXTERNAL_ID_UQ) && input.external_id) {
        throw new SessionExternalIdConflictError(input.external_id, { cause: error });
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
    .selectAll()
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
    .selectAll()
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
      return qb.set({ agent_spec: json(agent.spec) });
    })
    .$if(title !== undefined, qb => {
      if (title === undefined) {
        return qb;
      }
      return qb.set({ title });
    })
    .$if(metadata !== undefined, qb => {
      if (metadata === undefined) {
        return qb;
      }
      return qb.set({ metadata: json(metadata) });
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
  const order = input.order ?? 'desc';
  const cursor = decodeSessionListPageToken(input.page_token);

  let query = db
    .selectFrom('session')
    .selectAll()
    .select(
      sql<string>`to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as('updated_at_cursor'),
    )
    .where('tenant_id', '=', input.tenant_id);

  if (input.agent_id !== undefined) {
    query = query.where('agent_id', '=', input.agent_id);
  }
  if (input.created_by_subject_id !== undefined) {
    query = query.where(sql`created_by_subject->>'subject_id'`, '=', input.created_by_subject_id);
  }
  if (input.metadata !== undefined && Object.keys(input.metadata).length > 0) {
    query = query.where(sql<boolean>`metadata @> ${json(input.metadata)}`);
  }
  if (input.start_timestamp !== undefined) {
    query = query.where('created_at', '>=', input.start_timestamp);
  }
  if (input.end_timestamp !== undefined) {
    query = query.where('created_at', '<=', input.end_timestamp);
  }

  if (cursor) {
    const sessionId = cursor.session_id;
    // Bind the cursor string and cast in SQL so microsecond precision is preserved
    // (JS Date would truncate to milliseconds).
    const cursorUpdatedAt = sql<Date>`${cursor.updated_at}::timestamptz`;
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
  const { data: pageRows, pagination } = paginateSessionListRows(rows, limit, row => row.updated_at_cursor);

  return { data: pageRows.map(mapRowToSessionRecord), pagination };
}
