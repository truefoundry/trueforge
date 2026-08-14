import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type { SandboxBuildMetadata, SandboxProviderManifest } from '../../../schemas/sandboxProvider';
import {
  type ISandboxProviderStore,
  type SandboxProviderRecord,
  type UpdateSandboxStatusInput,
  type UpsertSandboxProviderInput,
} from '../../sandboxProviderStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting the JSONB manifest/build_metadata as parsed JSON (see JSON_RESULT_COLUMNS). */
function recordColumns(eb: ExpressionBuilder<Database, 'sandbox_provider'>) {
  return [
    'tenant_id' as const,
    jsonText<SandboxProviderManifest>(eb.ref('manifest')).as('manifest'),
    'status' as const,
    'status_reason' as const,
    jsonText<SandboxBuildMetadata>(eb.ref('build_metadata')).as('build_metadata'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

export class SqliteSandboxProviderStore implements ISandboxProviderStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getSandboxProvider(
    tenantId: string,
    transaction?: Transaction<Database>,
  ): Promise<SandboxProviderRecord | undefined> {
    const db = transaction ?? this.#db;
    return await db
      .selectFrom('sandbox_provider')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  /**
   * SQLite has no row-level FOR UPDATE; the required write transaction (BEGIN IMMEDIATE)
   * serializes concurrent writers so RMW of secrets stays consistent.
   */
  async getSandboxProviderForUpdate(
    tenantId: string,
    transaction: Transaction<Database>,
  ): Promise<SandboxProviderRecord | undefined> {
    return await transaction
      .selectFrom('sandbox_provider')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  async upsertSandboxProvider(
    input: UpsertSandboxProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxProviderRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    return await db
      .insertInto('sandbox_provider')
      .values({
        tenant_id: input.tenant_id,
        manifest: jsonbBind(input.manifest),
        status: input.status,
        status_reason: input.status_reason,
        build_metadata: input.build_metadata !== null ? jsonbBind(input.build_metadata) : null,
        created_at: timestamp,
        updated_at: timestamp,
      })
      .onConflict(oc =>
        oc.columns(['tenant_id']).doUpdateSet({
          manifest: jsonbBind(input.manifest),
          status: input.status,
          status_reason: input.status_reason,
          build_metadata: input.build_metadata !== null ? jsonbBind(input.build_metadata) : null,
          updated_at: timestamp,
        }),
      )
      .returning(recordColumns)
      .executeTakeFirstOrThrow();
  }

  async updateSandboxStatus(
    input: UpdateSandboxStatusInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxProviderRecord | undefined> {
    const db = transaction ?? this.#db;
    return await db
      .updateTable('sandbox_provider')
      .set({
        status: input.status,
        status_reason: input.status_reason,
        build_metadata: input.build_metadata !== null ? jsonbBind(input.build_metadata) : null,
        updated_at: nowIso(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .returning(recordColumns)
      .executeTakeFirst();
  }
}
