import { SubjectSchema, type Subject } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { sql, type ExpressionBuilder, type Kysely, type Transaction } from 'kysely';
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
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { ArtifactEntryContentType, ArtifactStorageBackendName, Database } from '../types';

function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, char => `\\${char}`)}%`;
}

function artifactColumns(eb: ExpressionBuilder<Database, 'artifact'>) {
  return [
    'id' as const,
    'tenant_id' as const,
    'slug' as const,
    'title' as const,
    'description' as const,
    'latest_version' as const,
    jsonText<Subject>(eb.ref('created_by_subject')).as('created_by_subject'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

function versionColumns(eb: ExpressionBuilder<Database, 'artifact_version'>) {
  return [
    'id' as const,
    'tenant_id' as const,
    'artifact_id' as const,
    'version' as const,
    'entry_path' as const,
    'entry_content_type' as const,
    'file_count' as const,
    'total_size_bytes' as const,
    'manifest_sha256' as const,
    'session_id' as const,
    'turn_id' as const,
    'source_root' as const,
    'note' as const,
    'storage_backend' as const,
    'storage_location' as const,
    jsonText<Subject>(eb.ref('created_by_subject')).as('created_by_subject'),
    'created_at' as const,
  ];
}

interface ArtifactRow {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  description: string | null;
  latest_version: number;
  created_by_subject: Subject;
  created_at: string;
  updated_at: string;
}

interface VersionRow {
  id: string;
  tenant_id: string;
  artifact_id: string;
  version: number;
  entry_path: string;
  entry_content_type: ArtifactEntryContentType;
  file_count: number;
  total_size_bytes: number;
  manifest_sha256: string;
  session_id: string;
  turn_id: string;
  source_root: string;
  note: string | null;
  storage_backend: ArtifactStorageBackendName;
  storage_location: string;
  created_by_subject: Subject;
  created_at: string;
}

function toArtifact(row: ArtifactRow): ArtifactRecord {
  return { ...row, created_by_subject: SubjectSchema.parse(row.created_by_subject) };
}

function toVersion(row: VersionRow): ArtifactVersionRecord {
  return { ...row, created_by_subject: SubjectSchema.parse(row.created_by_subject) };
}

export class SqliteArtifactStore implements IArtifactStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listArtifacts(input: ListArtifactsInput, transaction?: Transaction<Database>): Promise<ListArtifactsResult> {
    const db = transaction ?? this.#db;
    const offset = decodeOffsetPageToken(input.page_token);
    let query = db.selectFrom('artifact').select(artifactColumns).where('tenant_id', '=', input.tenant_id);
    if (input.slug !== undefined) {
      query = query.where('slug', '=', input.slug);
    }
    if (input.created_by_subject_id !== undefined) {
      query = query.where(sql`json_extract(created_by_subject, '$.subject_id')`, '=', input.created_by_subject_id);
    }
    if (input.query !== undefined && input.query !== '') {
      const pattern = likePattern(input.query);
      query = query.where(sql<boolean>`(title LIKE ${pattern} ESCAPE '\\' OR slug LIKE ${pattern} ESCAPE '\\')`);
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
      .select(artifactColumns)
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
      .select(artifactColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('slug', '=', input.slug)
      .executeTakeFirst();
    return row === undefined ? undefined : toArtifact(row);
  }

  async getArtifactForUpdate(
    input: GetArtifactInput,
    transaction: Transaction<Database>,
  ): Promise<ArtifactRecord | undefined> {
    return this.getArtifact(input, transaction);
  }

  async insertArtifact(input: InsertArtifactInput, transaction?: Transaction<Database>): Promise<ArtifactRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
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
          created_by_subject: jsonbBind(input.created_by_subject),
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returning(artifactColumns)
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
        updated_at: nowIso(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .returning(artifactColumns)
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
    const timestamp = nowIso();
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
        created_by_subject: jsonbBind(input.created_by_subject),
        created_at: timestamp,
      })
      .returning(versionColumns)
      .executeTakeFirstOrThrow();
    if (input.files.length > 0) {
      await db
        .insertInto('artifact_file')
        .values(
          input.files.map(file => ({
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
      .set({ latest_version: input.version, updated_at: timestamp })
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
      .select(versionColumns)
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
      .select(versionColumns)
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
      .select(versionColumns)
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
    return rows;
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
      .select(versionColumns)
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
