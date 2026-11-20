import { SubjectSchema, type Subject, type TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { sql, type ExpressionBuilder, type Kysely, type Transaction } from 'kysely';
import {
  newArtifactIdentity,
  type ArtifactRecord,
  type ArtifactVersionRecord,
  type CreateArtifactInput,
  type CreateArtifactVersionInput,
  type GetArtifactInput,
  type GetArtifactVersionInput,
  type IArtifactStore,
  type ListArtifactsInput,
} from '../../artifactStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting JSONB columns as parsed JSON (see JSON_RESULT_COLUMNS). */
function recordColumns(eb: ExpressionBuilder<Database, 'artifact'>) {
  return [
    'id' as const,
    'tenant_id' as const,
    'slug' as const,
    'title' as const,
    'latest_version' as const,
    jsonText<Subject>(eb.ref('created_by_subject')).as('created_by_subject'),
    'created_by_session_id' as const,
    'created_at' as const,
    'updated_at' as const,
  ];
}

function toArtifactRecord(row: {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  latest_version: number;
  created_by_subject: Subject;
  created_by_session_id: string;
  created_at: string;
  updated_at: string;
}): ArtifactRecord {
  return { ...row, created_by_subject: SubjectSchema.parse(row.created_by_subject) };
}

export class SqliteArtifactStore implements IArtifactStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async createArtifact(input: CreateArtifactInput, transaction?: Transaction<Database>): Promise<ArtifactRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    const row = await db
      .insertInto('artifact')
      .values({
        ...newArtifactIdentity(input.title),
        tenant_id: input.tenant_id,
        latest_version: 0,
        created_by_subject: jsonbBind(input.created_by_subject),
        created_by_session_id: input.created_by_session_id,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .returning(recordColumns)
      .executeTakeFirstOrThrow();
    return toArtifactRecord(row);
  }

  async getArtifact(input: GetArtifactInput, transaction?: Transaction<Database>): Promise<ArtifactRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('artifact')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('slug', '=', input.slug)
      .executeTakeFirst();
    return row === undefined ? undefined : toArtifactRecord(row);
  }

  async listArtifacts(
    input: ListArtifactsInput,
    transaction?: Transaction<Database>,
  ): Promise<{ data: ArtifactRecord[]; pagination: TokenPagination }> {
    const offset = decodeOffsetPageToken(input.page_token);
    const db = transaction ?? this.#db;
    let query = db
      .selectFrom('artifact')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where(sql`json_extract(created_by_subject, '$.subject_id')`, '=', input.created_by_subject_id);
    if (input.created_by_session_id !== undefined) {
      query = query.where('created_by_session_id', '=', input.created_by_session_id);
    }
    if (input.title !== undefined) {
      query = query.where(sql<boolean>`instr(lower(title), lower(${input.title})) > 0`);
    }
    if (input.updated_since !== undefined) {
      query = query.where('updated_at', '>=', input.updated_since.toISOString());
    }
    if (input.updated_before !== undefined) {
      query = query.where('updated_at', '<', input.updated_before.toISOString());
    }
    const rows = await query
      .orderBy('updated_at', 'desc')
      .orderBy('id')
      .limit(input.limit + 1)
      .offset(offset)
      .execute();
    const { data, pagination } = paginateOffsetRows(rows, input.limit, offset);
    return { data: data.map(toArtifactRecord), pagination };
  }

  async createVersion(
    input: CreateArtifactVersionInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionRecord | undefined> {
    // SQLite transactions are BEGIN IMMEDIATE, so version writes for one artifact already serialise.
    const write = async (db: Transaction<Database>): Promise<ArtifactVersionRecord | undefined> => {
      const artifact = await db
        .selectFrom('artifact')
        .select(['id', 'latest_version'])
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.artifact_id)
        .executeTakeFirst();
      if (artifact === undefined) {
        return undefined;
      }
      const version = artifact.latest_version + 1;
      const timestamp = nowIso();
      const row = await db
        .insertInto('artifact_version')
        .values({
          artifact_id: artifact.id,
          version,
          storage_prefix: input.storage_prefix,
          total_bytes: input.total_bytes,
          created_at: timestamp,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .updateTable('artifact')
        .set({ latest_version: version, updated_at: timestamp })
        .where('id', '=', artifact.id)
        .execute();
      return row;
    };
    return transaction ? write(transaction) : this.#db.transaction().execute(write);
  }

  async getVersion(
    input: GetArtifactVersionInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionRecord | undefined> {
    const db = transaction ?? this.#db;
    return db
      .selectFrom('artifact_version')
      .innerJoin('artifact', 'artifact.id', 'artifact_version.artifact_id')
      .selectAll('artifact_version')
      .where('artifact.tenant_id', '=', input.tenant_id)
      .where('artifact_version.artifact_id', '=', input.artifact_id)
      .where('artifact_version.version', '=', input.version)
      .executeTakeFirst();
  }
}
