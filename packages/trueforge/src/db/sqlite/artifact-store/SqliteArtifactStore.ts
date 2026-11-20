import { SubjectSchema, type Subject, type TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { sql, type ExpressionBuilder, type Kysely, type Transaction } from 'kysely';
import { newId } from '../../../utils/id';
import {
  ArtifactSlugConflictError,
  type ArtifactRecord,
  type ArtifactVersionKey,
  type ArtifactVersionRecord,
  type ArtifactVersionWithFiles,
  type CommitArtifactVersionInput,
  type CreateArtifactInput,
  type CreateArtifactVersionInput,
  type GetArtifactInput,
  type IArtifactStore,
  type ListArtifactsInput,
} from '../../artifactStore';
import { isUniqueViolation } from '../client';
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
    try {
      const row = await db
        .insertInto('artifact')
        .values({
          id: newId(),
          tenant_id: input.tenant_id,
          slug: input.slug,
          title: input.title,
          latest_version: 0,
          created_by_subject: jsonbBind(input.created_by_subject),
          created_by_session_id: input.created_by_session_id,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returning(recordColumns)
        .executeTakeFirstOrThrow();
      return toArtifactRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ArtifactSlugConflictError({ tenant_id: input.tenant_id, slug: input.slug }, { cause: error });
      }
      throw error;
    }
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
    const rows = await db
      .selectFrom('artifact')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where(sql`json_extract(created_by_subject, '$.subject_id')`, '=', input.created_by_subject_id)
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
      const artifact = await this.#findArtifact(input, db);
      if (artifact === undefined) {
        return undefined;
      }
      const { max_version } = await db
        .selectFrom('artifact_version')
        .select(eb => eb.fn.coalesce(eb.fn.max('version'), sql<number>`0`).as('max_version'))
        .where('artifact_id', '=', artifact.id)
        .executeTakeFirstOrThrow();
      const timestamp = nowIso();
      return db
        .insertInto('artifact_version')
        .values({
          artifact_id: artifact.id,
          version: max_version + 1,
          status: 'pending',
          entrypoint: input.entrypoint,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    };
    return transaction ? write(transaction) : this.#db.transaction().execute(write);
  }

  async commitVersion(
    input: CommitArtifactVersionInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactRecord | undefined> {
    const write = async (db: Transaction<Database>): Promise<ArtifactRecord | undefined> => {
      const artifact = await this.#findArtifact(input, db);
      if (artifact === undefined) {
        return undefined;
      }
      const timestamp = nowIso();
      const committed = await db
        .updateTable('artifact_version')
        .set({ status: 'committed', updated_at: timestamp })
        .where('artifact_id', '=', artifact.id)
        .where('version', '=', input.version)
        .where('status', '=', 'pending')
        .returning('version')
        .executeTakeFirst();
      if (committed === undefined) {
        return undefined;
      }
      if (input.files.length > 0) {
        await db
          .insertInto('artifact_file')
          .values(
            input.files.map(file => ({
              ...file,
              artifact_id: artifact.id,
              version: committed.version,
              created_at: timestamp,
            })),
          )
          .execute();
      }
      const row = await db
        .updateTable('artifact')
        .set({ latest_version: sql<number>`MAX(latest_version, ${committed.version})`, updated_at: timestamp })
        .where('id', '=', artifact.id)
        .returning(recordColumns)
        .executeTakeFirstOrThrow();
      return toArtifactRecord(row);
    };
    return transaction ? write(transaction) : this.#db.transaction().execute(write);
  }

  async failVersion(input: ArtifactVersionKey, transaction?: Transaction<Database>): Promise<boolean> {
    const db = transaction ?? this.#db;
    const artifact = await this.#findArtifact(input, db);
    if (artifact === undefined) {
      return false;
    }
    const result = await db
      .updateTable('artifact_version')
      .set({ status: 'failed', updated_at: nowIso() })
      .where('artifact_id', '=', artifact.id)
      .where('version', '=', input.version)
      .where('status', '=', 'pending')
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async getVersion(
    input: ArtifactVersionKey,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionWithFiles | undefined> {
    const db = transaction ?? this.#db;
    const artifact = await this.#findArtifact(input, db);
    if (artifact === undefined) {
      return undefined;
    }
    const version = await db
      .selectFrom('artifact_version')
      .selectAll()
      .where('artifact_id', '=', artifact.id)
      .where('version', '=', input.version)
      .executeTakeFirst();
    if (version === undefined) {
      return undefined;
    }
    const files = await db
      .selectFrom('artifact_file')
      .select(['path', 'size_bytes', 'storage_key', 'sha256', 'created_at'])
      .where('artifact_id', '=', artifact.id)
      .where('version', '=', input.version)
      .orderBy('path')
      .execute();
    return { ...version, files };
  }

  /** Artifact id when it belongs to the tenant. */
  async #findArtifact(
    input: { tenant_id: string; artifact_id: string },
    db: Kysely<Database> | Transaction<Database>,
  ): Promise<{ id: string } | undefined> {
    return db
      .selectFrom('artifact')
      .select('id')
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.artifact_id)
      .executeTakeFirst();
  }
}
