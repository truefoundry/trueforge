import {
  CreatedBySubjectSchema,
  type CreatedBySubject,
  type TokenPagination,
} from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import type { Kysely, Transaction } from 'kysely';
import { sql } from 'kysely';
import { NameSchema } from '../../../schemas/common';
import {
  DEFAULT_SANDBOX_ENVIRONMENT_NAME,
  SandboxEnvironmentVersionInternalMetadataSchema,
  type SandboxEnvironmentVersionInternalMetadata,
  type StoredSandboxEnvironmentManifest,
} from '../../../schemas/sandboxEnvironment';
import { newId } from '../../../utils/id';
import { hashSandboxEnvironmentSecret, isRedactedSecretValue, SECRET_REDACTION } from '../../../utils/secretRedaction';
import {
  parseStoredSandboxEnvironmentManifest,
  SandboxEnvironmentNameConflictError,
  SandboxEnvironmentVersionConflictError,
  type CreateSandboxEnvironmentInput,
  type DeleteSandboxEnvironmentInput,
  type GetSandboxEnvironmentInput,
  type GetSandboxEnvironmentVersionInput,
  type ISandboxEnvironmentStore,
  type ListSandboxEnvironmentsInput,
  type MarkSandboxEnvironmentVersionFailedInput,
  type MarkSandboxEnvironmentVersionReadyInput,
  type SandboxEnvironmentRecord,
  type SandboxEnvironmentSecretRecord,
  type SandboxEnvironmentVersionForProgress,
  type SandboxEnvironmentVersionRecord,
  type SandboxEnvironmentWithVersion,
  type UpsertSandboxEnvironmentInput,
  type UpsertSandboxEnvironmentVersionWrite,
} from '../../sandboxEnvironmentStore';
import { isUniqueViolation } from '../client';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

function toSecretRecord(row: {
  id: string;
  tenant_id: string;
  environment_id: string;
  secret_name: string;
  external_secret_name: string;
  external_secret_id: string;
  description: string;
  hash: string;
  created_at: string;
  updated_at: string;
}): SandboxEnvironmentSecretRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    environment_id: row.environment_id,
    secret_name: row.secret_name,
    external_secret_name: row.external_secret_name,
    external_secret_id: row.external_secret_id,
    description: row.description,
    hash: row.hash,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function activeVersionJoin(db: Kysely<Database> | Transaction<Database>) {
  return db
    .selectFrom('sandbox_environment as env')
    .innerJoin('sandbox_environment_version as ver', join =>
      join.onRef('ver.environment_id', '=', 'env.id').onRef('ver.version', '=', 'env.active_version'),
    )
    .select([
      'env.id',
      'env.tenant_id',
      'env.name',
      'env.description',
      'env.active_version',
      'env.lifecycle_stage',
      jsonText<CreatedBySubject>(sql.ref('env.created_by_subject')).as('created_by_subject'),
      'env.created_at',
      'env.updated_at',
      'ver.id as ver_id',
      'ver.environment_id as ver_environment_id',
      'ver.version as ver_version',
      jsonText<StoredSandboxEnvironmentManifest>(sql.ref('ver.manifest')).as('ver_manifest'),
      'ver.status as ver_status',
      'ver.status_reason as ver_status_reason',
      'ver.external_ref as ver_external_ref',
      jsonText<SandboxEnvironmentVersionInternalMetadata>(sql.ref('ver.internal_metadata')).as('ver_internal_metadata'),
      jsonText<CreatedBySubject>(sql.ref('ver.created_by_subject')).as('ver_created_by_subject'),
      'ver.created_at as ver_created_at',
      'ver.updated_at as ver_updated_at',
    ]);
}

function latestVersionJoin(db: Kysely<Database> | Transaction<Database>) {
  return db
    .selectFrom('sandbox_environment as env')
    .innerJoin('sandbox_environment_version as ver', 'ver.environment_id', 'env.id')
    .select([
      'env.id',
      'env.tenant_id',
      'env.name',
      'env.description',
      'env.active_version',
      'env.lifecycle_stage',
      jsonText<CreatedBySubject>(sql.ref('env.created_by_subject')).as('created_by_subject'),
      'env.created_at',
      'env.updated_at',
      'ver.id as ver_id',
      'ver.environment_id as ver_environment_id',
      'ver.version as ver_version',
      jsonText<StoredSandboxEnvironmentManifest>(sql.ref('ver.manifest')).as('ver_manifest'),
      'ver.status as ver_status',
      'ver.status_reason as ver_status_reason',
      'ver.external_ref as ver_external_ref',
      jsonText<SandboxEnvironmentVersionInternalMetadata>(sql.ref('ver.internal_metadata')).as('ver_internal_metadata'),
      jsonText<CreatedBySubject>(sql.ref('ver.created_by_subject')).as('ver_created_by_subject'),
      'ver.created_at as ver_created_at',
      'ver.updated_at as ver_updated_at',
    ])
    .where(
      sql<boolean>`ver.version = (
        SELECT MAX(latest.version)
        FROM sandbox_environment_version AS latest
        WHERE latest.environment_id = env.id
      )`,
    );
}

function versionSelect() {
  return [
    'id' as const,
    'environment_id' as const,
    'version' as const,
    jsonText<StoredSandboxEnvironmentManifest>(sql.ref('manifest')).as('manifest'),
    'status' as const,
    'status_reason' as const,
    'external_ref' as const,
    jsonText<SandboxEnvironmentVersionInternalMetadata>(sql.ref('internal_metadata')).as('internal_metadata'),
    jsonText<CreatedBySubject>(sql.ref('created_by_subject')).as('created_by_subject'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

function toEnvironmentRecord(row: {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  active_version: number;
  lifecycle_stage: SandboxEnvironmentRecord['lifecycle_stage'];
  created_by_subject: CreatedBySubject;
  created_at: string;
  updated_at: string;
}): SandboxEnvironmentRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: NameSchema.parse(row.name),
    description: row.description,
    active_version: row.active_version,
    lifecycle_stage: row.lifecycle_stage,
    created_by_subject: CreatedBySubjectSchema.parse(row.created_by_subject),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toVersionRecord(row: {
  id: string;
  environment_id: string;
  version: number;
  manifest: StoredSandboxEnvironmentManifest;
  status: SandboxEnvironmentVersionRecord['status'];
  status_reason: string | null;
  external_ref: string;
  internal_metadata: SandboxEnvironmentVersionInternalMetadata;
  created_by_subject: CreatedBySubject;
  created_at: string;
  updated_at: string;
}): SandboxEnvironmentVersionRecord {
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
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function toWithVersion(row: {
  id: string;
  tenant_id: string;
  name: string;
  description: string;
  active_version: number;
  lifecycle_stage: SandboxEnvironmentRecord['lifecycle_stage'];
  created_by_subject: CreatedBySubject;
  created_at: string;
  updated_at: string;
  ver_id: string;
  ver_environment_id: string;
  ver_version: number;
  ver_manifest: StoredSandboxEnvironmentManifest;
  ver_status: SandboxEnvironmentVersionRecord['status'];
  ver_status_reason: string | null;
  ver_external_ref: string;
  ver_internal_metadata: SandboxEnvironmentVersionInternalMetadata;
  ver_created_by_subject: CreatedBySubject;
  ver_created_at: string;
  ver_updated_at: string;
}): SandboxEnvironmentWithVersion {
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

export class SqliteSandboxEnvironmentStore implements ISandboxEnvironmentStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: Transaction<Database>,
  ): Promise<{ data: SandboxEnvironmentWithVersion[]; pagination: TokenPagination }> {
    const db = transaction ?? this.#db;
    const query = latestVersionJoin(db)
      .where('env.tenant_id', '=', input.tenant_id)
      .where('env.lifecycle_stage', '=', 'active')
      .where(eb =>
        eb.or([
          eb('env.name', '=', DEFAULT_SANDBOX_ENVIRONMENT_NAME),
          eb.and([
            eb('env.name', '!=', DEFAULT_SANDBOX_ENVIRONMENT_NAME),
            eb(sql`json_extract(env.created_by_subject, '$.subject_id')`, '=', input.created_by_subject_id),
          ]),
        ]),
      )
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
    let query = latestVersionJoin(db)
      .where('env.tenant_id', '=', input.tenant_id)
      .where('env.name', '=', input.name)
      .where('env.lifecycle_stage', '=', 'active');
    if (input.created_by_subject_id && input.name !== DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      query = query.where(sql`json_extract(env.created_by_subject, '$.subject_id')`, '=', input.created_by_subject_id);
    }
    const row = await query.executeTakeFirst();
    if (!row) {
      return undefined;
    }
    return this.#withMountedSecrets(toWithVersion(row), db);
  }

  async getActiveEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    const db = transaction ?? this.#db;
    let query = activeVersionJoin(db)
      .where('env.tenant_id', '=', input.tenant_id)
      .where('env.name', '=', input.name)
      .where('env.lifecycle_stage', '=', 'active');
    if (input.created_by_subject_id && input.name !== DEFAULT_SANDBOX_ENVIRONMENT_NAME) {
      query = query.where(sql`json_extract(env.created_by_subject, '$.subject_id')`, '=', input.created_by_subject_id);
    }
    const row = await query.executeTakeFirst();
    if (!row) {
      return undefined;
    }
    return this.#withMountedSecrets(toWithVersion(row), db);
  }

  async listLatestPendingVersions(transaction?: Transaction<Database>): Promise<string[]> {
    const db = transaction ?? this.#db;
    const rows = await sql<{ id: string }>`
      SELECT version.id
      FROM sandbox_environment_version AS version
      INNER JOIN sandbox_environment AS environment
        ON environment.id = version.environment_id
      INNER JOIN (
        SELECT environment_id, MAX(version) AS version
        FROM sandbox_environment_version
        WHERE status = 'pending'
        GROUP BY environment_id
      ) AS tip
        ON tip.environment_id = version.environment_id
       AND tip.version = version.version
      WHERE version.status = 'pending'
        AND environment.lifecycle_stage = 'active'
      ORDER BY version.created_at ASC
    `.execute(db);
    return rows.rows.map(row => row.id);
  }

  async getSandboxEnvironmentVersion(
    input: GetSandboxEnvironmentVersionInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentVersionForProgress | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('sandbox_environment_version as ver')
      .innerJoin('sandbox_environment as env', 'env.id', 'ver.environment_id')
      .select([
        'ver.id',
        'env.tenant_id',
        'env.name as environment_name',
        'ver.environment_id',
        'ver.version',
        'ver.external_ref',
        jsonText<StoredSandboxEnvironmentManifest>(sql.ref('ver.manifest')).as('manifest'),
        jsonText<SandboxEnvironmentVersionInternalMetadata>(sql.ref('ver.internal_metadata')).as('internal_metadata'),
      ])
      .where('ver.id', '=', input.environment_version_id)
      .where('env.lifecycle_stage', '=', 'active')
      .executeTakeFirst();
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      tenant_id: row.tenant_id,
      environment_id: row.environment_id,
      environment_name: row.environment_name,
      version: row.version,
      external_ref: row.external_ref,
      manifest: parseStoredSandboxEnvironmentManifest(row.manifest),
      internal_metadata: SandboxEnvironmentVersionInternalMetadataSchema.parse(row.internal_metadata),
    };
  }

  async createEnvironment(
    input: CreateSandboxEnvironmentInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentWithVersion> {
    if (transaction) {
      return this.#writeEnvironment(input, transaction, { mode: 'create' });
    }
    return this.#db.transaction().execute(db => this.#writeEnvironment(input, db, { mode: 'create' }));
  }

  async upsertEnvironment(
    input: UpsertSandboxEnvironmentInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentWithVersion> {
    if (transaction) {
      return this.#writeEnvironment(input, transaction, { mode: 'upsert' });
    }
    return this.#db.transaction().execute(db => this.#writeEnvironment(input, db, { mode: 'upsert' }));
  }

  async #writeEnvironment(
    input: UpsertSandboxEnvironmentInput,
    db: Transaction<Database>,
    options: { mode: 'create' | 'upsert' },
  ): Promise<SandboxEnvironmentWithVersion> {
    // `"default"` is tenant-wide (no owner filter); public CRUD rejects that name in the request schema.
    // Store still allows it so ensureDefaultSandboxEnvironment can upsert the system tip.
    const isDefault = input.name === DEFAULT_SANDBOX_ENVIRONMENT_NAME;
    let environmentQuery = db
      .selectFrom('sandbox_environment')
      .select([
        'id',
        'tenant_id',
        'name',
        'description',
        'active_version',
        'lifecycle_stage',
        jsonText<CreatedBySubject>(sql.ref('created_by_subject')).as('created_by_subject'),
        'created_at',
        'updated_at',
      ])
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .where('lifecycle_stage', '=', 'active');
    if (!isDefault) {
      environmentQuery = environmentQuery.where(
        sql`json_extract(created_by_subject, '$.subject_id')`,
        '=',
        input.created_by_subject.subject_id,
      );
    }
    const environmentRow = await environmentQuery.executeTakeFirst();

    if (environmentRow && options.mode === 'create') {
      throw new SandboxEnvironmentNameConflictError({ tenant_id: input.tenant_id, name: input.name });
    }

    if (!environmentRow) {
      const environment_id = newId();
      const created_at = nowIso();
      // Parent first so secret FKs can resolve in this transaction.
      try {
        await db
          .insertInto('sandbox_environment')
          .values({
            id: environment_id,
            tenant_id: input.tenant_id,
            name: input.name,
            description: input.description,
            active_version: 1,
            lifecycle_stage: 'active',
            created_by_subject: jsonbBind(input.created_by_subject),
            created_at,
            updated_at: created_at,
          })
          .execute();
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new SandboxEnvironmentNameConflictError(
            { tenant_id: input.tenant_id, name: input.name },
            { cause: error },
          );
        }
        throw error;
      }
      const versionWrite = await this.#buildVersion({
        input,
        environment_id,
        db,
      });
      const version = await this.#insertVersionRow(db, environment_id, versionWrite);
      return {
        environment: {
          id: environment_id,
          tenant_id: input.tenant_id,
          name: input.name,
          description: input.description,
          active_version: versionWrite.version,
          lifecycle_stage: 'active',
          created_by_subject: input.created_by_subject,
          created_at,
          updated_at: created_at,
        },
        version,
      };
    }

    const previousVersion = await db
      .selectFrom('sandbox_environment_version')
      .select(versionSelect())
      .where('environment_id', '=', environmentRow.id)
      .orderBy('version', 'desc')
      .executeTakeFirstOrThrow();
    const versionWrite = await this.#buildVersion({
      input,
      environment_id: environmentRow.id,
      db,
      existing_version: previousVersion.version,
      existing_manifest: parseStoredSandboxEnvironmentManifest(previousVersion.manifest),
      existing_external_ref: previousVersion.external_ref,
    });
    const updated_at = nowIso();

    const version = await this.#insertVersionRow(db, environmentRow.id, versionWrite);
    const result = await db
      .updateTable('sandbox_environment')
      .set({
        ...(versionWrite.status === 'ready' ? { active_version: versionWrite.version } : {}),
        description: input.description,
        updated_at,
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', environmentRow.id)
      .where('lifecycle_stage', '=', 'active')
      .executeTakeFirst();
    if (!Number(result.numUpdatedRows)) {
      throw new SandboxEnvironmentVersionConflictError(
        { environment_id: environmentRow.id, version: versionWrite.version },
        { cause: new Error('Sandbox environment disappeared during upsert') },
      );
    }
    const nextActiveVersion = versionWrite.status === 'ready' ? versionWrite.version : environmentRow.active_version;
    return {
      environment: toEnvironmentRecord({
        ...environmentRow,
        description: input.description,
        active_version: nextActiveVersion,
        updated_at,
      }),
      version,
    };
  }

  async markVersionReady(
    input: MarkSandboxEnvironmentVersionReadyInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    if (transaction) {
      return this.#markVersionReady(input, transaction);
    }
    return this.#db.transaction().execute(db => this.#markVersionReady(input, db));
  }

  async #markVersionReady(
    input: MarkSandboxEnvironmentVersionReadyInput,
    db: Transaction<Database>,
  ): Promise<SandboxEnvironmentWithVersion | undefined> {
    const updated_at = nowIso();
    const versionRow = await db
      .selectFrom('sandbox_environment_version')
      .select(['id', 'environment_id', 'version'])
      .where('id', '=', input.environment_version_id)
      .executeTakeFirst();
    if (!versionRow) {
      return undefined;
    }
    const versionResult = await db
      .updateTable('sandbox_environment_version')
      .set({
        status: 'ready',
        status_reason: null,
        updated_at,
      })
      .where('id', '=', input.environment_version_id)
      .executeTakeFirst();
    if (!Number(versionResult.numUpdatedRows)) {
      return undefined;
    }
    await db
      .updateTable('sandbox_environment')
      .set({
        active_version: versionRow.version,
        updated_at,
      })
      .where('id', '=', versionRow.environment_id)
      .where('lifecycle_stage', '=', 'active')
      .where('active_version', '<=', versionRow.version)
      .executeTakeFirst();
    const row = await activeVersionJoin(db).where('env.id', '=', versionRow.environment_id).executeTakeFirst();
    return row ? toWithVersion(row) : undefined;
  }

  async markVersionFailed(
    input: MarkSandboxEnvironmentVersionFailedInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentVersionRecord | undefined> {
    const db = transaction ?? this.#db;
    const result = await db
      .updateTable('sandbox_environment_version')
      .set({
        status: 'failed',
        status_reason: input.status_reason,
        updated_at: nowIso(),
      })
      .where('id', '=', input.environment_version_id)
      .executeTakeFirst();
    if (!Number(result.numUpdatedRows)) {
      return undefined;
    }
    const row = await db
      .selectFrom('sandbox_environment_version')
      .select(versionSelect())
      .where('id', '=', input.environment_version_id)
      .executeTakeFirst();
    return row ? toVersionRecord(row) : undefined;
  }

  async deleteEnvironment(input: DeleteSandboxEnvironmentInput, transaction?: Transaction<Database>): Promise<void> {
    if (transaction) {
      return this.#deleteEnvironment(input, transaction);
    }
    return this.#db.transaction().execute(db => this.#deleteEnvironment(input, db));
  }

  async #deleteEnvironment(input: DeleteSandboxEnvironmentInput, db: Transaction<Database>): Promise<void> {
    const environment = await db
      .selectFrom('sandbox_environment')
      .select('id')
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .where('lifecycle_stage', '=', 'active')
      .where(sql`json_extract(created_by_subject, '$.subject_id')`, '=', input.created_by_subject_id)
      .executeTakeFirst();
    if (environment === undefined) {
      return;
    }
    await db.deleteFrom('sandbox_environment_secret').where('environment_id', '=', environment.id).execute();
    await db
      .updateTable('sandbox_environment')
      .set({
        lifecycle_stage: 'deleted',
        updated_at: nowIso(),
      })
      .where('id', '=', environment.id)
      .execute();
  }

  async #buildVersion({
    input,
    environment_id,
    db,
    existing_version,
    existing_manifest,
    existing_external_ref,
  }: {
    input: UpsertSandboxEnvironmentInput;
    environment_id: string;
    db: Transaction<Database>;
    existing_version?: number;
    existing_manifest?: StoredSandboxEnvironmentManifest;
    existing_external_ref?: string;
  }): Promise<UpsertSandboxEnvironmentVersionWrite> {
    const built = await input.buildVersion({
      environment_id,
      ...(existing_version ? { existing_version } : {}),
      ...(existing_manifest ? { existing_manifest } : {}),
      ...(existing_external_ref ? { existing_external_ref } : {}),
    });
    const secretDescription = `Secret value of environment ${built.manifest.name}`;
    const existingSecretByName = new Map(
      (await this.listSecretsByEnvironment({ environment_id }, db)).map(row => [row.secret_name, row]),
    );
    const syncedByName = new Map(input.synced_secrets.map(secret => [secret.secret_name, secret]));
    const desiredNames = new Set((built.manifest.networking?.secrets ?? []).map(secret => secret.env));
    const secrets: { key: string; id: string }[] = [];
    for (const secret of built.manifest.networking?.secrets ?? []) {
      const existing = existingSecretByName.get(secret.env);
      const synced = syncedByName.get(secret.env);
      if (synced === undefined) {
        throw new Error(`Synced sandbox environment secret missing for ${secret.env}`);
      }
      const hash = !isRedactedSecretValue(secret.value)
        ? hashSandboxEnvironmentSecret({ tenant_id: input.tenant_id, value: secret.value })
        : existing?.hash;
      if (!hash) {
        throw new Error(`Sandbox environment secret hash missing for ${secret.env}`);
      }
      const timestamp = nowIso();
      const row = await db
        .insertInto('sandbox_environment_secret')
        .values({
          id: newId(),
          tenant_id: input.tenant_id,
          environment_id,
          secret_name: secret.env,
          external_secret_name: synced.external_secret_name,
          external_secret_id: synced.external_secret_id,
          description: secretDescription,
          hash,
          created_at: timestamp,
          updated_at: timestamp,
        })
        .onConflict(oc =>
          oc.columns(['environment_id', 'secret_name']).doUpdateSet({
            external_secret_name: synced.external_secret_name,
            external_secret_id: synced.external_secret_id,
            description: secretDescription,
            hash,
            updated_at: timestamp,
          }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();
      secrets.push({ key: secret.env, id: row.id });
    }
    const removedIds = [...existingSecretByName.values()]
      .filter(row => !desiredNames.has(row.secret_name))
      .map(row => row.id);
    if (removedIds.length > 0) {
      await db.deleteFrom('sandbox_environment_secret').where('id', 'in', removedIds).execute();
    }
    const networking = built.manifest.networking;
    return {
      ...built,
      manifest: {
        ...built.manifest,
        ...(networking?.secrets
          ? {
              networking: {
                ...networking,
                secrets: networking.secrets.map(secret => ({ ...secret, value: SECRET_REDACTION })),
              },
            }
          : {}),
      },
      internal_metadata: { secrets },
    };
  }

  async listSecretsByEnvironment(
    input: { environment_id: string },
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentSecretRecord[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('sandbox_environment_secret')
      .selectAll()
      .where('environment_id', '=', input.environment_id)
      .execute();
    return rows.map(toSecretRecord);
  }

  async #withMountedSecrets(
    loaded: SandboxEnvironmentWithVersion,
    db: Kysely<Database> | Transaction<Database>,
  ): Promise<SandboxEnvironmentWithVersion> {
    const refs = loaded.version.internal_metadata.secrets;
    if (refs.length === 0) {
      return loaded;
    }
    const rows = await db
      .selectFrom('sandbox_environment_secret')
      .selectAll()
      .where(
        'id',
        'in',
        refs.map(ref => ref.id),
      )
      .execute();
    const byId = new Map(rows.map(row => [row.id, row]));
    const mounted_secrets: Record<string, string> = {};
    for (const ref of refs) {
      const row = byId.get(ref.id);
      if (row !== undefined) {
        mounted_secrets[ref.key] = row.external_secret_name;
      }
    }
    return Object.keys(mounted_secrets).length > 0 ? { ...loaded, mounted_secrets } : loaded;
  }

  async #insertVersionRow(
    db: Kysely<Database> | Transaction<Database>,
    environment_id: string,
    version: UpsertSandboxEnvironmentVersionWrite,
  ): Promise<SandboxEnvironmentVersionRecord> {
    const id = newId();
    const created_at = nowIso();
    try {
      await db
        .insertInto('sandbox_environment_version')
        .values({
          id,
          environment_id,
          version: version.version,
          manifest: jsonbBind(version.manifest),
          status: version.status,
          status_reason: version.status_reason,
          external_ref: version.external_ref,
          internal_metadata: jsonbBind(version.internal_metadata),
          created_by_subject: jsonbBind(version.created_by_subject),
          created_at,
          updated_at: created_at,
        })
        .execute();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SandboxEnvironmentVersionConflictError(
          { environment_id, version: version.version },
          { cause: error },
        );
      }
      throw error;
    }
    const row = await db
      .selectFrom('sandbox_environment_version')
      .select(versionSelect())
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return toVersionRecord(row);
  }
}
