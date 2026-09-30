import { CreatedBySubjectSchema, type TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import type { Kysely, Selectable, Transaction } from 'kysely';
import { sql } from 'kysely';
import { NameSchema } from '../../../schemas/common';
import { SandboxEnvironmentVersionInternalMetadataSchema } from '../../../schemas/sandboxEnvironment';
import { newId } from '../../../utils/id';
import { SANDBOX_ENVIRONMENT_TENANT_NAME_ACTIVE_UQ, SANDBOX_ENVIRONMENT_VERSION_UQ } from '../../indexes';
import {
  SandboxEnvironmentNameConflictError,
  SandboxEnvironmentVersionConflictError,
  parseStoredSandboxEnvironmentManifest,
  toUpsertSandboxEnvironmentVersionWrite,
  type DeleteSandboxEnvironmentInput,
  type GetSandboxEnvironmentInput,
  type ISandboxEnvironmentStore,
  type ListSandboxEnvironmentsInput,
  type MarkSandboxEnvironmentVersionActiveInput,
  type MarkSandboxEnvironmentVersionFailedInput,
  type SandboxEnvironmentRecord,
  type SandboxEnvironmentVersionRecord,
  type SandboxEnvironmentWithVersion,
  type UpsertSandboxEnvironmentInput,
  type UpsertSandboxEnvironmentVersionWrite,
} from '../../sandboxEnvironmentStore';
import { isPgConstraint, isUniqueViolation } from '../client';
import { json, now } from '../sqlExpressions';
import type { Database, SandboxEnvironmentTable, SandboxEnvironmentVersionTable } from '../types';

type JoinedRow = Selectable<SandboxEnvironmentTable> & {
  ver_id: string;
  ver_environment_id: string;
  ver_version: number;
  ver_manifest: Selectable<SandboxEnvironmentVersionTable>['manifest'];
  ver_status: Selectable<SandboxEnvironmentVersionTable>['status'];
  ver_status_reason: string | null;
  ver_external_ref: string;
  ver_internal_metadata: Selectable<SandboxEnvironmentVersionTable>['internal_metadata'];
  ver_created_by_subject: Selectable<SandboxEnvironmentVersionTable>['created_by_subject'];
  ver_created_at: Date;
  ver_updated_at: Date;
};

function toEnvironmentRecord(row: Selectable<SandboxEnvironmentTable>): SandboxEnvironmentRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: NameSchema.parse(row.name),
    description: row.description,
    active_version: row.active_version,
    lifecycle_stage: row.lifecycle_stage,
    created_by_subject: CreatedBySubjectSchema.parse(row.created_by_subject),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toVersionRecord(row: Selectable<SandboxEnvironmentVersionTable>): SandboxEnvironmentVersionRecord {
  return {
    id: row.id,
    environment_id: row.environment_id,
    version: row.version,
    manifest: parseStoredSandboxEnvironmentManifest(row.manifest),
    status: row.status,
    status_reason: row.status_reason,
    external_ref: row.external_ref,
    internal_metadata: SandboxEnvironmentVersionInternalMetadataSchema.parse(row.internal_metadata),
    created_by_subject: CreatedBySubjectSchema.parse(row.created_by_subject),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

function toWithVersion(row: JoinedRow): SandboxEnvironmentWithVersion {
  return {
    environment: toEnvironmentRecord(row),
    version: toVersionRecord({
      id: row.ver_id,
      environment_id: row.ver_environment_id,
      version: row.ver_version,
      manifest: row.ver_manifest,
      status: row.ver_status,
      status_reason: row.ver_status_reason,
      external_ref: row.ver_external_ref,
      internal_metadata: row.ver_internal_metadata,
      created_by_subject: row.ver_created_by_subject,
      created_at: row.ver_created_at,
      updated_at: row.ver_updated_at,
    }),
  };
}

function activeVersionJoin(db: Kysely<Database> | Transaction<Database>) {
  return db
    .selectFrom('sandbox_environment as env')
    .innerJoin('sandbox_environment_version as ver', join =>
      join.onRef('ver.environment_id', '=', 'env.id').onRef('ver.version', '=', 'env.active_version'),
    )
    .selectAll('env')
    .select([
      'ver.id as ver_id',
      'ver.environment_id as ver_environment_id',
      'ver.version as ver_version',
      'ver.manifest as ver_manifest',
      'ver.status as ver_status',
      'ver.status_reason as ver_status_reason',
      'ver.external_ref as ver_external_ref',
      'ver.internal_metadata as ver_internal_metadata',
      'ver.created_by_subject as ver_created_by_subject',
      'ver.created_at as ver_created_at',
      'ver.updated_at as ver_updated_at',
    ]);
}

export class PostgresSandboxEnvironmentStore implements ISandboxEnvironmentStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: Transaction<Database>,
  ): Promise<{ data: SandboxEnvironmentWithVersion[]; pagination: TokenPagination }> {
    const db = transaction ?? this.#db;
    const query = activeVersionJoin(db)
      .where('env.tenant_id', '=', input.tenant_id)
      .where('env.lifecycle_stage', '=', 'active')
      .where(sql`env.created_by_subject->>'subject_id'`, '=', input.created_by_subject_id)
      .orderBy('env.name');
    if (!input.limit) {
      const rows = await query.execute();
      return { data: rows.map(toWithVersion), pagination: { limit: rows.length } };
    }
    const offset = decodeOffsetPageToken(input.page_token);
    const rows = await query
      .limit(input.limit + 1)
      .offset(offset)
      .execute();
    const { data, pagination } = paginateOffsetRows(rows, input.limit, offset);
    return { data: data.map(toWithVersion), pagination };
  }

  async getEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    const db = transaction ?? this.#db;
    let query = activeVersionJoin(db)
      .where('env.tenant_id', '=', input.tenant_id)
      .where('env.name', '=', input.name)
      .where('env.lifecycle_stage', '=', 'active');
    if (input.created_by_subject_id) {
      query = query.where(sql`env.created_by_subject->>'subject_id'`, '=', input.created_by_subject_id);
    }
    const row = await query.executeTakeFirst();
    return row ? toWithVersion(row) : undefined;
  }

  async upsertEnvironment(
    input: UpsertSandboxEnvironmentInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentWithVersion> {
    if (transaction) {
      return this.#upsertEnvironment(input, transaction);
    }
    return this.#db.transaction().execute(db => this.#upsertEnvironment(input, db));
  }

  async #upsertEnvironment(
    input: UpsertSandboxEnvironmentInput,
    db: Transaction<Database>,
  ): Promise<SandboxEnvironmentWithVersion> {
    const environmentRow = await db
      .selectFrom('sandbox_environment')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .where('lifecycle_stage', '=', 'active')
      .where(sql`created_by_subject->>'subject_id'`, '=', input.created_by_subject.subject_id)
      .forUpdate()
      .executeTakeFirst();

    if (!environmentRow) {
      const environment_id = newId();
      const versionWrite = toUpsertSandboxEnvironmentVersionWrite(input.buildVersion());
      // First version: point here so get/list join works; later versions only move the
      // pointer when their status is (or becomes) active.
      const active_version = versionWrite.version;
      try {
        const created = await db
          .insertInto('sandbox_environment')
          .values({
            id: environment_id,
            tenant_id: input.tenant_id,
            name: input.name,
            description: input.description,
            active_version,
            lifecycle_stage: 'active',
            created_by_subject: json(input.created_by_subject),
            created_at: now(),
            updated_at: now(),
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        return {
          environment: toEnvironmentRecord(created),
          version: await this.#insertVersionRow(db, environment_id, versionWrite),
        };
      } catch (error) {
        if (isUniqueViolation(error) || isPgConstraint(error, SANDBOX_ENVIRONMENT_TENANT_NAME_ACTIVE_UQ)) {
          throw new SandboxEnvironmentNameConflictError(
            { tenant_id: input.tenant_id, name: input.name },
            { cause: error },
          );
        }
        throw error;
      }
    }

    const previousVersion = await db
      .selectFrom('sandbox_environment_version')
      .selectAll()
      .where('environment_id', '=', environmentRow.id)
      .orderBy('version', 'desc')
      .executeTakeFirstOrThrow();
    const versionWrite = toUpsertSandboxEnvironmentVersionWrite(
      input.buildVersion({
        latest_version: previousVersion.version,
        previous_manifest: parseStoredSandboxEnvironmentManifest(previousVersion.manifest),
        previous_external_ref: previousVersion.external_ref,
      }),
    );
    const version = await this.#insertVersionRow(db, environmentRow.id, versionWrite);
    const updated = await db
      .updateTable('sandbox_environment')
      .set({
        ...(versionWrite.status === 'active' ? { active_version: versionWrite.version } : {}),
        description: input.description,
        updated_at: now(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', environmentRow.id)
      .where('lifecycle_stage', '=', 'active')
      .returningAll()
      .executeTakeFirst();
    if (!updated) {
      throw new SandboxEnvironmentVersionConflictError(
        { environment_id: environmentRow.id, version: versionWrite.version },
        { cause: new Error('Sandbox environment disappeared during upsert') },
      );
    }
    return { environment: toEnvironmentRecord(updated), version };
  }

  async markVersionActive(
    input: MarkSandboxEnvironmentVersionActiveInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (transaction) {
      return this.#markVersionActive(input, transaction);
    }
    return this.#db.transaction().execute(db => this.#markVersionActive(input, db));
  }

  async #markVersionActive(
    input: MarkSandboxEnvironmentVersionActiveInput,
    db: Transaction<Database>,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    const versionRow = await db
      .updateTable('sandbox_environment_version')
      .set({
        status: 'active',
        status_reason: null,
        updated_at: now(),
      })
      .where('environment_id', '=', input.environment_id)
      .where('version', '=', input.version)
      .returningAll()
      .executeTakeFirst();
    if (!versionRow) {
      return undefined;
    }
    const parentUpdated = await db
      .updateTable('sandbox_environment')
      .set({
        active_version: input.version,
        updated_at: now(),
      })
      .where('id', '=', input.environment_id)
      .where('lifecycle_stage', '=', 'active')
      .executeTakeFirst();
    if (!Number(parentUpdated.numUpdatedRows)) {
      return undefined;
    }
    const row = await activeVersionJoin(db).where('env.id', '=', input.environment_id).executeTakeFirst();
    return row ? toWithVersion(row) : undefined;
  }

  async markVersionFailed(
    input: MarkSandboxEnvironmentVersionFailedInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentVersionRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .updateTable('sandbox_environment_version')
      .set({
        status: 'failed',
        status_reason: input.status_reason,
        updated_at: now(),
      })
      .where('environment_id', '=', input.environment_id)
      .where('version', '=', input.version)
      .returningAll()
      .executeTakeFirst();
    return row ? toVersionRecord(row) : undefined;
  }

  async deleteEnvironment(input: DeleteSandboxEnvironmentInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db
      .updateTable('sandbox_environment')
      .set({
        lifecycle_stage: 'deleted',
        updated_at: now(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .where('lifecycle_stage', '=', 'active')
      .where(sql`created_by_subject->>'subject_id'`, '=', input.created_by_subject_id)
      .execute();
  }

  async #insertVersionRow(
    db: Kysely<Database> | Transaction<Database>,
    environment_id: string,
    version: UpsertSandboxEnvironmentVersionWrite,
  ): Promise<SandboxEnvironmentVersionRecord> {
    try {
      const row = await db
        .insertInto('sandbox_environment_version')
        .values({
          id: newId(),
          environment_id,
          version: version.version,
          manifest: json(version.manifest),
          status: version.status,
          status_reason: version.status_reason,
          external_ref: version.external_ref,
          internal_metadata: json(version.internal_metadata),
          created_by_subject: json(version.created_by_subject),
          created_at: now(),
          updated_at: now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toVersionRecord(row);
    } catch (error) {
      if (isUniqueViolation(error) || isPgConstraint(error, SANDBOX_ENVIRONMENT_VERSION_UQ)) {
        throw new SandboxEnvironmentVersionConflictError(
          { environment_id, version: version.version },
          { cause: error },
        );
      }
      throw error;
    }
  }
}
