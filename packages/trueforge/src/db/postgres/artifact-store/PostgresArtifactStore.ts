import { SubjectSchema } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import {
  ArtifactSlugConflictError,
  type ArtifactFileRecord,
  type ArtifactRecord,
  type ArtifactVersionRecord,
  type DeleteArtifactInput,
  type GetArtifactBySlugInput,
  type GetArtifactInput,
  type GetArtifactVersionInput,
  type IArtifactStore,
  type InsertArtifactInput,
  type InsertArtifactVersionInput,
  type ListArtifactsInput,
  type ListArtifactsResult,
  type ListArtifactVersionsInput,
  type ListArtifactVersionsResult,
  type UpdateArtifactInput,
} from '../../artifactStore';
import { isUniqueViolation } from '../client';
import { json, now } from '../sqlExpressions';
import type { ArtifactFileTable, ArtifactTable, ArtifactVersionTable, Database } from '../types';

function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

function toArtifact(row: Selectable<ArtifactTable>): ArtifactRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    latest_version: row.latest_version,
    created_by_subject: SubjectSchema.parse(row.created_by_subject),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toVersion(row: Selectable<ArtifactVersionTable>): ArtifactVersionRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    artifact_id: row.artifact_id,
    version: row.version,
    entry_path: row.entry_path,
    entry_content_type: row.entry_content_type,
    file_count: row.file_count,
    total_size_bytes: row.total_size_bytes,
    manifest_sha256: row.manifest_sha256,
    session_id: row.session_id,
    turn_id: row.turn_id,
    source_root: row.source_root,
    note: row.note,
    storage_backend: row.storage_backend,
    storage_location: row.storage_location,
    created_by_subject: SubjectSchema.parse(row.created_by_subject),
    created_at: row.created_at.toISOString(),
  };
}

export class PostgresArtifactStore implements IArtifactStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listArtifacts(input: ListArtifactsInput, transaction?: Transaction<Database>): Promise<ListArtifactsResult> {
    const db = transaction ?? this.#db;
    const offset = decodeOffsetPageToken(input.page_token);
    let query = db.selectFrom('artifact').selectAll().where('tenant_id', '=', input.tenant_id);
    if (input.slug !== undefined) {
      query = query.where('slug', '=', input.slug);
    }
    if (input.created_by_subject_id !== undefined) {
      query = query.where(sql`created_by_subject->>'subject_id'`, '=', input.created_by_subject_id);
    }
    if (input.query !== undefined && input.query !== '') {
      const pattern = likePattern(input.query);
      query = query.where(sql<boolean>`(title ILIKE ${pattern} ESCAPE '\\' OR slug ILIKE ${pattern} ESCAPE '\\')`);
    }
    if (input.session_id !== undefined) {
      const sessionId = input.session_id;
      query = query.where('id', 'in', eb =>
        eb
          .selectFrom('artifact_version')
          .select('artifact_id')
          .where('tenant_id', '=', input.tenant_id)
          .where('session_id', '=', sessionId),
      );
    }
    const rows = await query
      .orderBy('updated_at', 'desc')
      .orderBy('id', 'desc')
      .limit(input.limit + 1)
      .offset(offset)
      .execute();
    const page = paginateOffsetRows(rows, input.limit, offset);
    return { data: page.data.map(toArtifact), pagination: page.pagination };
  }

  async getArtifact(input: GetArtifactInput, transaction?: Transaction<Database>): Promise<ArtifactRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('artifact')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return row === undefined ? undefined : toArtifact(row);
  }

  async getArtifactBySlug(
    input: GetArtifactBySlugInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('artifact')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('slug', '=', input.slug)
      .executeTakeFirst();
    return row === undefined ? undefined : toArtifact(row);
  }

  async getArtifactForUpdate(
    input: GetArtifactInput,
    transaction: Transaction<Database>,
  ): Promise<ArtifactRecord | undefined> {
    const row = await transaction
      .selectFrom('artifact')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .forUpdate()
      .executeTakeFirst();
    return row === undefined ? undefined : toArtifact(row);
  }

  async insertArtifact(input: InsertArtifactInput, transaction?: Transaction<Database>): Promise<ArtifactRecord> {
    const db = transaction ?? this.#db;
    try {
      const row = await db
        .insertInto('artifact')
        .values({
          id: input.id,
          tenant_id: input.tenant_id,
          slug: input.slug,
          title: input.title,
          description: input.description,
          latest_version: 0,
          created_by_subject: json(input.created_by_subject),
          created_at: now(),
          updated_at: now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toArtifact(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ArtifactSlugConflictError({ cause: error });
      }
      throw error;
    }
  }

  async updateArtifact(
    input: UpdateArtifactInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .updateTable('artifact')
      .set({
        title: input.title,
        ...(input.description === undefined ? {} : { description: input.description }),
        updated_at: now(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toArtifact(row);
  }

  async deleteArtifact(input: DeleteArtifactInput, transaction?: Transaction<Database>): Promise<boolean> {
    const db = transaction ?? this.#db;
    const result = await db
      .deleteFrom('artifact')
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }

  async insertVersion(
    input: InsertArtifactVersionInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionRecord> {
    const db = transaction ?? this.#db;
    const row = await db
      .insertInto('artifact_version')
      .values({
        id: input.id,
        tenant_id: input.tenant_id,
        artifact_id: input.artifact_id,
        version: input.version,
        entry_path: input.entry_path,
        entry_content_type: input.entry_content_type,
        file_count: input.file_count,
        total_size_bytes: input.total_size_bytes,
        manifest_sha256: input.manifest_sha256,
        session_id: input.session_id,
        turn_id: input.turn_id,
        source_root: input.source_root,
        note: input.note,
        storage_backend: input.storage_backend,
        storage_location: input.storage_location,
        created_by_subject: json(input.created_by_subject),
        created_at: now(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    if (input.files.length > 0) {
      await db
        .insertInto('artifact_file')
        .values(
          input.files.map((file): InsertableFile => ({
            artifact_version_id: input.id,
            tenant_id: input.tenant_id,
            path: file.path,
            size_bytes: file.size_bytes,
            sha256: file.sha256,
            media_type: file.media_type,
          })),
        )
        .execute();
    }
    await db
      .updateTable('artifact')
      .set({ latest_version: input.version, updated_at: now() })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.artifact_id)
      .execute();
    return toVersion(row);
  }

  async getVersion(
    input: GetArtifactVersionInput,
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('artifact_version')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('artifact_id', '=', input.artifact_id)
      .where('version', '=', input.version)
      .executeTakeFirst();
    return row === undefined ? undefined : toVersion(row);
  }

  async getVersionById(
    input: { tenant_id: string; id: string },
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('artifact_version')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return row === undefined ? undefined : toVersion(row);
  }

  async listVersions(
    input: ListArtifactVersionsInput,
    transaction?: Transaction<Database>,
  ): Promise<ListArtifactVersionsResult> {
    const db = transaction ?? this.#db;
    const offset = decodeOffsetPageToken(input.page_token);
    const rows = await db
      .selectFrom('artifact_version')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('artifact_id', '=', input.artifact_id)
      .orderBy('version', 'desc')
      .limit(input.limit + 1)
      .offset(offset)
      .execute();
    const page = paginateOffsetRows(rows, input.limit, offset);
    return { data: page.data.map(toVersion), pagination: page.pagination };
  }

  async listVersionLocations(
    input: { tenant_id: string; artifact_id: string },
    transaction?: Transaction<Database>,
  ): Promise<Pick<ArtifactVersionRecord, 'storage_backend' | 'storage_location'>[]> {
    const db = transaction ?? this.#db;
    return db
      .selectFrom('artifact_version')
      .select(['storage_backend', 'storage_location'])
      .where('tenant_id', '=', input.tenant_id)
      .where('artifact_id', '=', input.artifact_id)
      .execute();
  }

  async listFiles(
    input: { tenant_id: string; artifact_version_id: string },
    transaction?: Transaction<Database>,
  ): Promise<ArtifactFileRecord[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('artifact_file')
      .select(['path', 'size_bytes', 'sha256', 'media_type'])
      .where('tenant_id', '=', input.tenant_id)
      .where('artifact_version_id', '=', input.artifact_version_id)
      .orderBy('path', 'asc')
      .execute();
    return rows.map(toFile);
  }

  async listFilesForVersions(
    input: { tenant_id: string; artifact_version_ids: readonly string[] },
    transaction?: Transaction<Database>,
  ): Promise<{ artifact_version_id: string; file: ArtifactFileRecord }[]> {
    if (input.artifact_version_ids.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('artifact_file')
      .select(['artifact_version_id', 'path', 'size_bytes', 'sha256', 'media_type'])
      .where('tenant_id', '=', input.tenant_id)
      .where('artifact_version_id', 'in', [...input.artifact_version_ids])
      .orderBy('path', 'asc')
      .execute();
    return rows.map(row => ({
      artifact_version_id: row.artifact_version_id,
      file: { path: row.path, size_bytes: row.size_bytes, sha256: row.sha256, media_type: row.media_type },
    }));
  }

  async listLatestVersions(
    input: { tenant_id: string; artifact_ids: readonly string[] },
    transaction?: Transaction<Database>,
  ): Promise<ArtifactVersionRecord[]> {
    if (input.artifact_ids.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('artifact_version')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('artifact_id', 'in', [...input.artifact_ids])
      .where(
        sql<boolean>`version = (SELECT latest_version FROM artifact WHERE artifact.id = artifact_version.artifact_id)`,
      )
      .execute();
    return rows.map(toVersion);
  }

  async sumVersionBytes(input: { tenant_id: string }, transaction?: Transaction<Database>): Promise<number> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('artifact_version')
      .select(sql<string | number | null>`SUM(total_size_bytes)`.as('total'))
      .where('tenant_id', '=', input.tenant_id)
      .executeTakeFirst();
    return Number(row?.total ?? 0);
  }
}

interface InsertableFile {
  artifact_version_id: string;
  tenant_id: string;
  path: string;
  size_bytes: number;
  sha256: string;
  media_type: string;
}

function toFile(
  row: Pick<Selectable<ArtifactFileTable>, 'path' | 'size_bytes' | 'sha256' | 'media_type'>,
): ArtifactFileRecord {
  return {
    path: row.path,
    size_bytes: row.size_bytes,
    sha256: row.sha256,
    media_type: row.media_type,
  };
}
