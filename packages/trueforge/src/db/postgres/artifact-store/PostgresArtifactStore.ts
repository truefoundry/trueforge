import { SubjectSchema } from '@truefoundry/trueforge-core/agent-session';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
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
import { json, now } from '../sqlExpressions';
import type { ArtifactTable, ArtifactVersionTable, Database } from '../types';

function toArtifactRecord(row: Selectable<ArtifactTable>): ArtifactRecord {
  return {
    ...row,
    created_by_subject: SubjectSchema.parse(row.created_by_subject),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toVersionRecord(row: Selectable<ArtifactVersionTable>): ArtifactVersionRecord {
  return {
    ...row,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** Locks the tenant's artifact row so version writes for one artifact serialise. */
async function lockArtifact(db: Transaction<Database>, input: { tenant_id: string; artifact_id: string }) {
  return db
    .selectFrom('artifact')
    .select('id')
    .where('tenant_id', '=', input.tenant_id)
    .where('id', '=', input.artifact_id)
    .forUpdate()
    .executeTakeFirst();
}

export class PostgresArtifactStore implements IArtifactStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async createArtifact(input: CreateArtifactInput): Promise<ArtifactRecord> {
    try {
      const row = await this.#db
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

  async getArtifact(input: GetArtifactInput): Promise<ArtifactRecord | undefined> {
    const row = await this.#db
      .selectFrom('artifact')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('slug', '=', input.slug)
      .executeTakeFirst();
    return row ? toArtifactRecord(row) : undefined;
  }

  async createVersion(input: CreateArtifactVersionInput): Promise<ArtifactVersionRecord | undefined> {
    return this.#db.transaction().execute(async db => {
      const artifact = await lockArtifact(db, input);
      if (artifact === undefined) {
        return undefined;
      }
      const { max_version } = await db
        .selectFrom('artifact_version')
        .select(eb => eb.fn.coalesce(eb.fn.max('version'), sql<number>`0`).as('max_version'))
        .where('artifact_id', '=', artifact.id)
        .executeTakeFirstOrThrow();
      const row = await db
        .insertInto('artifact_version')
        .values({
          artifact_id: artifact.id,
          version: max_version + 1,
          status: 'pending',
          entrypoint: input.entrypoint,
          created_by_turn_id: input.created_by_turn_id,
          created_at: now(),
          updated_at: now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toVersionRecord(row);
    });
  }

  async commitVersion(input: CommitArtifactVersionInput): Promise<ArtifactRecord | undefined> {
    return this.#db.transaction().execute(async db => {
      const artifact = await lockArtifact(db, input);
      if (artifact === undefined) {
        return undefined;
      }
      const committed = await db
        .updateTable('artifact_version')
        .set({ status: 'committed', updated_at: now() })
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
              created_at: now(),
            })),
          )
          .execute();
      }
      const row = await db
        .updateTable('artifact')
        .set({ latest_version: sql<number>`GREATEST(latest_version, ${committed.version})`, updated_at: now() })
        .where('id', '=', artifact.id)
        .returningAll()
        .executeTakeFirstOrThrow();
      return toArtifactRecord(row);
    });
  }

  async failVersion(input: ArtifactVersionKey): Promise<boolean> {
    const result = await this.#db
      .updateTable('artifact_version')
      .set({ status: 'failed', updated_at: now() })
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
    return { ...toVersionRecord(version), files };
  }
}
