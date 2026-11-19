import { SubjectSchema, type Subject } from '@truefoundry/trueforge-core/agent-session';
import { sql, type Kysely } from 'kysely';
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
} from '../../artifactStore';
import { isUniqueViolation } from '../client';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

const ARTIFACT_COLUMNS = [
  'id',
  'tenant_id',
  'slug',
  'title',
  'latest_version',
  jsonText<Subject>(sql.ref('created_by_subject')).as('created_by_subject'),
  'created_by_session_id',
  'created_at',
  'updated_at',
] as const;

function toArtifactRecord(row: ArtifactRecord): ArtifactRecord {
  return { ...row, created_by_subject: SubjectSchema.parse(row.created_by_subject) };
}

export class SqliteArtifactStore implements IArtifactStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactRecord> {
    const timestamp = nowIso();
    try {
      const row = await this.#db
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
        .returning(ARTIFACT_COLUMNS)
        .executeTakeFirstOrThrow();
      return toArtifactRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ArtifactSlugConflictError({ tenant_id: input.tenant_id, slug: input.slug }, { cause: error });
      }
      throw error;
    }
  }

  async getArtifact(input: GetArtifactInput): Promise<ArtifactRecord | undefined> {
    const row = await this.#db
      .selectFrom('artifact')
      .select(ARTIFACT_COLUMNS)
      .where('tenant_id', '=', input.tenant_id)
      .where('slug', '=', input.slug)
      .executeTakeFirst();
    return row ? toArtifactRecord(row) : undefined;
  }

  // SQLite transactions are BEGIN IMMEDIATE, so version writes for one artifact already serialise.
  async createVersion(input: CreateArtifactVersionInput): Promise<ArtifactVersionRecord | undefined> {
    return this.#db.transaction().execute(async db => {
      const artifact = await db
        .selectFrom('artifact')
        .select('id')
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.artifact_id)
        .executeTakeFirst();
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
          created_by_turn_id: input.created_by_turn_id,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async commitVersion(input: CommitArtifactVersionInput): Promise<ArtifactRecord | undefined> {
    return this.#db.transaction().execute(async db => {
      const artifact = await db
        .selectFrom('artifact')
        .select('id')
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.artifact_id)
        .executeTakeFirst();
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
          .values(input.files.map(file => ({ ...file, artifact_id: artifact.id, version: committed.version })))
          .execute();
      }
      const row = await db
        .updateTable('artifact')
        .set({ latest_version: sql<number>`MAX(latest_version, ${committed.version})`, updated_at: timestamp })
        .where('id', '=', artifact.id)
        .returning(ARTIFACT_COLUMNS)
        .executeTakeFirstOrThrow();
      return toArtifactRecord(row);
    });
  }

  async failVersion(input: ArtifactVersionKey): Promise<boolean> {
    const result = await this.#db
      .updateTable('artifact_version')
      .set({ status: 'failed', updated_at: nowIso() })
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
      .executeTakeFirst();
    return result.numUpdatedRows > 0n;
  }

  async getVersion(input: ArtifactVersionKey): Promise<ArtifactVersionWithFiles | undefined> {
    const version = await this.#db
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
    const files = await this.#db
      .selectFrom('artifact_file')
      .select(['path', 'size_bytes', 'storage_key', 'sha256'])
      .where('artifact_id', '=', input.artifact_id)
      .where('version', '=', input.version)
      .orderBy('path')
      .execute();
    return { ...version, files };
  }
}
