import { SubjectSchema, type TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { newId } from '../../../utils/id';
import {
  ArtifactSlugConflictError,
  type ArtifactFileRecord,
  type ArtifactRecord,
  type ArtifactVersionKey,
  type ArtifactVersionRecord,
  type ArtifactVersionWithFiles,
  type CommitArtifactVersionInput,
  type CreateArtifactInput,
  type CreateArtifactVersionInput,
  type DeleteArtifactInput,
  type GetArtifactInput,
  type IArtifactStore,
  type ListArtifactsInput,
  type ListArtifactVersionsInput,
  type UpdateArtifactInput,
} from '../../artifactStore';
import { ARTIFACT_TENANT_SLUG_UQ } from '../../indexes';
import { isPgConstraint, isUniqueViolation } from '../client';
import { json, now } from '../sqlExpressions';
import type { ArtifactFileTable, ArtifactTable, ArtifactVersionTable, Database } from '../types';

type Db = Kysely<Database> | Transaction<Database>;

function toArtifactRecord(row: Selectable<ArtifactTable>): ArtifactRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    slug: row.slug,
    title: row.title,
    kind: row.kind,
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
    status: row.status,
    entrypoint: row.entrypoint,
    total_bytes: row.total_bytes,
    created_by_subject: SubjectSchema.parse(row.created_by_subject),
    created_by_session_id: row.created_by_session_id,
    created_by_turn_id: row.created_by_turn_id,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toFileRecord(row: Selectable<ArtifactFileTable>): ArtifactFileRecord {
  return {
    path: row.path,
    size_bytes: row.size_bytes,
    content_type: row.content_type,
    storage_key: row.storage_key,
    sha256: row.sha256,
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
          kind: input.kind,
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
      if (isUniqueViolation(error) && isPgConstraint(error, ARTIFACT_TENANT_SLUG_UQ)) {
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
    return row ? toArtifactRecord(row) : undefined;
  }

  async listArtifacts(
    input: ListArtifactsInput,
    transaction?: Transaction<Database>,
  ): Promise<{ data: ArtifactRecord[]; pagination: TokenPagination }> {
    const db = transaction ?? this.#db;
    let query = db
      .selectFrom('artifact')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc');
    if (input.created_by_session_id !== undefined) {
      query = query.where('created_by_session_id', '=', input.created_by_session_id);
    }
    if (input.kind !== undefined) {
      query = query.where('kind', '=', input.kind);
    }
    if (!input.limit) {
      const rows = await query.execute();
      return { data: rows.map(toArtifactRecord), pagination: { limit: rows.length } };
    }
    const offset = decodeOffsetPageToken(input.page_token);
    const rows = await query
      .limit(input.limit + 1)
      .offset(offset)
      .execute();
    const { data, pagination } = paginateOffsetRows(rows, input.limit, offset);
    return { data: data.map(toArtifactRecord), pagination };
  }

  async updateArtifact(
    input: UpdateArtifactInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .updateTable('artifact')
      .set({ title: input.title, updated_at: now() })
      .where('tenant_id', '=', input.tenant_id)
      .where('slug', '=', input.slug)
      .returningAll()
      .executeTakeFirst();
    return row ? toArtifactRecord(row) : undefined;
  }

  async deleteArtifact(input: DeleteArtifactInput, transaction?: Transaction<Database>): Promise<string | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .deleteFrom('artifact')
      .where('tenant_id', '=', input.tenant_id)
      .where('slug', '=', input.slug)
      .returning('id')
      .executeTakeFirst();
    return row?.id;
  }

  async createVersion(
    input: CreateArtifactVersionInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionWithFiles | undefined> {
    const write = async (db: Transaction<Database>): Promise<ArtifactVersionWithFiles | undefined> => {
      // Row lock serialises version allocation for this artifact.
      const artifact = await db
        .selectFrom('artifact')
        .select('id')
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.artifact_id)
        .forUpdate()
        .executeTakeFirst();
      if (artifact === undefined) {
        return undefined;
      }
      const { max_version } = await db
        .selectFrom('artifact_version')
        .select(eb => eb.fn.coalesce(eb.fn.max('version'), sql<number>`0`).as('max_version'))
        .where('artifact_id', '=', artifact.id)
        .executeTakeFirstOrThrow();
      const version = await db
        .insertInto('artifact_version')
        .values({
          artifact_id: artifact.id,
          version: max_version + 1,
          status: 'pending',
          entrypoint: input.entrypoint,
          total_bytes: input.files.reduce((sum, file) => sum + file.size_bytes, 0),
          created_by_subject: json(input.created_by_subject),
          created_by_session_id: input.created_by_session_id,
          created_by_turn_id: input.created_by_turn_id,
          created_at: now(),
          updated_at: now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const files =
        input.files.length === 0
          ? []
          : await db
              .insertInto('artifact_file')
              .values(input.files.map(file => ({ ...file, artifact_id: artifact.id, version: version.version })))
              .returningAll()
              .execute();
      return { ...toVersionRecord(version), files: files.map(toFileRecord) };
    };
    return transaction ? write(transaction) : this.#db.transaction().execute(write);
  }

  async getVersion(
    input: ArtifactVersionKey,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionWithFiles | undefined> {
    const db = transaction ?? this.#db;
    const version = await db
      .selectFrom('artifact_version as ver')
      .innerJoin('artifact as art', 'art.id', 'ver.artifact_id')
      .selectAll('ver')
      .where('art.tenant_id', '=', input.tenant_id)
      .where('ver.artifact_id', '=', input.artifact_id)
      .where('ver.version', '=', input.version)
      .executeTakeFirst();
    if (version === undefined) {
      return undefined;
    }
    const files = await db
      .selectFrom('artifact_file')
      .selectAll()
      .where('artifact_id', '=', input.artifact_id)
      .where('version', '=', input.version)
      .orderBy('path')
      .execute();
    return { ...toVersionRecord(version), files: files.map(toFileRecord) };
  }

  async listVersions(
    input: ListArtifactVersionsInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionRecord[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('artifact_version as ver')
      .innerJoin('artifact as art', 'art.id', 'ver.artifact_id')
      .selectAll('ver')
      .where('art.tenant_id', '=', input.tenant_id)
      .where('ver.artifact_id', '=', input.artifact_id)
      .orderBy('ver.version', 'desc')
      .execute();
    return rows.map(toVersionRecord);
  }

  async commitVersion(
    input: CommitArtifactVersionInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactRecord | undefined> {
    const write = async (db: Transaction<Database>): Promise<ArtifactRecord | undefined> => {
      const committed = await this.#transitionPending(db, input, 'committed');
      if (committed === undefined) {
        return undefined;
      }
      const artifact = await db
        .updateTable('artifact')
        .set({
          latest_version: sql<number>`GREATEST(latest_version, ${committed.version})`,
          kind: input.kind,
          updated_at: now(),
        })
        .where('id', '=', committed.artifact_id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return toArtifactRecord(artifact);
    };
    return transaction ? write(transaction) : this.#db.transaction().execute(write);
  }

  async failVersion(
    input: ArtifactVersionKey,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionRecord | undefined> {
    const row = await this.#transitionPending(transaction ?? this.#db, input, 'failed');
    return row ? toVersionRecord(row) : undefined;
  }

  async #transitionPending(
    db: Db,
    input: ArtifactVersionKey,
    status: 'committed' | 'failed',
  ): Promise<Selectable<ArtifactVersionTable> | undefined> {
    return db
      .updateTable('artifact_version')
      .set({ status, updated_at: now() })
      .where('artifact_id', '=', input.artifact_id)
      .where('version', '=', input.version)
      .where('status', '=', 'pending')
      .where(eb =>
        eb.exists(
          eb
            .selectFrom('artifact')
            .select('artifact.id')
            .whereRef('artifact.id', '=', 'artifact_version.artifact_id')
            .where('artifact.tenant_id', '=', input.tenant_id),
        ),
      )
      .returningAll()
      .executeTakeFirst();
  }
}
