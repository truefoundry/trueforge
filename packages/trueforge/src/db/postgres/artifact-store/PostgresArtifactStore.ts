import { SubjectSchema, type TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { newId } from '../../../utils/id';
import {
  ArtifactSlugConflictError,
  type ArtifactRecord,
  type ArtifactVersionRecord,
  type CreateArtifactInput,
  type CreateArtifactVersionInput,
  type GetArtifactInput,
  type GetArtifactVersionInput,
  type IArtifactStore,
  type ListArtifactsInput,
} from '../../artifactStore';
import { isUniqueViolation } from '../client';
import { json, now } from '../sqlExpressions';
import type { ArtifactTable, ArtifactVersionTable, Database } from '../types';

function toArtifactRecord(row: Selectable<ArtifactTable>): ArtifactRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    slug: row.slug,
    title: row.title,
    latest_version: row.latest_version,
    created_by_subject: SubjectSchema.parse(row.created_by_subject),
    created_by_session_id: row.created_by_session_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toVersionRecord(row: Selectable<ArtifactVersionTable>): ArtifactVersionRecord {
  return {
    artifact_id: row.artifact_id,
    version: row.version,
    entrypoint: row.entrypoint,
    storage_prefix: row.storage_prefix,
    total_bytes: row.total_bytes,
    created_at: row.created_at.toISOString(),
  };
}

export class PostgresArtifactStore implements IArtifactStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async createArtifact(input: CreateArtifactInput, transaction?: Transaction<Database>): Promise<ArtifactRecord> {
    const db = transaction ?? this.#db;
    try {
      const row = await db
        .insertInto('artifact')
        .values({
          id: newId(),
          tenant_id: input.tenant_id,
          slug: input.slug,
          title: input.title,
          latest_version: 0,
          created_by_subject: json(input.created_by_subject),
          created_by_session_id: input.created_by_session_id,
          created_at: now(),
          updated_at: now(),
        })
        .returningAll()
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
      .selectAll()
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
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where(sql`created_by_subject->>'subject_id'`, '=', input.created_by_subject_id)
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
    const write = async (db: Transaction<Database>): Promise<ArtifactVersionRecord | undefined> => {
      const artifact = await this.#lockArtifact(input, db);
      if (artifact === undefined) {
        return undefined;
      }
      const { max_version } = await db
        .selectFrom('artifact_version')
        .select(eb => eb.fn.coalesce(eb.fn.max('version'), sql<number>`0`).as('max_version'))
        .where('artifact_id', '=', artifact.id)
        .executeTakeFirstOrThrow();
      const version = max_version + 1;
      const row = await db
        .insertInto('artifact_version')
        .values({
          artifact_id: artifact.id,
          version,
          entrypoint: input.entrypoint,
          storage_prefix: input.storage_prefix,
          total_bytes: input.total_bytes,
          created_at: now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await db
        .updateTable('artifact')
        .set({ latest_version: version, updated_at: now() })
        .where('id', '=', artifact.id)
        .execute();
      return toVersionRecord(row);
    };
    return transaction ? write(transaction) : this.#db.transaction().execute(write);
  }

  async getVersion(
    input: GetArtifactVersionInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('artifact_version')
      .innerJoin('artifact', 'artifact.id', 'artifact_version.artifact_id')
      .selectAll('artifact_version')
      .where('artifact.tenant_id', '=', input.tenant_id)
      .where('artifact_version.artifact_id', '=', input.artifact_id)
      .where('artifact_version.version', '=', input.version)
      .executeTakeFirst();
    return row === undefined ? undefined : toVersionRecord(row);
  }

  /** Row lock so concurrent version writes for one artifact queue instead of racing. */
  async #lockArtifact(
    input: { tenant_id: string; artifact_id: string },
    db: Transaction<Database>,
  ): Promise<{ id: string } | undefined> {
    return db
      .selectFrom('artifact')
      .select('id')
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.artifact_id)
      .forUpdate()
      .executeTakeFirst();
  }
}
