import type { Kysely, Selectable, Transaction } from 'kysely';
import {
  type ISandboxProviderStore,
  type SandboxProviderRecord,
  type UpdateSandboxStatusInput,
  type UpsertSandboxProviderInput,
} from '../../sandboxProviderStore';
import { json, now } from '../sqlExpressions';
import type { Database, SandboxProviderTable } from '../types';

function toRecord(row: Selectable<SandboxProviderTable>): SandboxProviderRecord {
  return {
    tenant_id: row.tenant_id,
    manifest: row.manifest,
    status: row.status,
    status_reason: row.status_reason,
    build_metadata: row.build_metadata,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresSandboxProviderStore implements ISandboxProviderStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getSandboxProvider(
    tenantId: string,
    transaction?: Transaction<Database>,
  ): Promise<SandboxProviderRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('sandbox_provider')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async getSandboxProviderForUpdate(
    tenantId: string,
    transaction: Transaction<Database>,
  ): Promise<SandboxProviderRecord | undefined> {
    const row = await transaction
      .selectFrom('sandbox_provider')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .forUpdate()
      .executeTakeFirst();
    return row ? toRecord(row) : undefined;
  }

  async upsertSandboxProvider(
    input: UpsertSandboxProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxProviderRecord> {
    const db = transaction ?? this.#db;
    const row = await db
      .insertInto('sandbox_provider')
      .values({
        tenant_id: input.tenant_id,
        manifest: json(input.manifest),
        status: input.status,
        status_reason: input.status_reason,
        build_metadata: input.build_metadata !== null ? json(input.build_metadata) : null,
        created_at: now(),
        updated_at: now(),
      })
      .onConflict(oc =>
        oc.columns(['tenant_id']).doUpdateSet({
          manifest: json(input.manifest),
          status: input.status,
          status_reason: input.status_reason,
          build_metadata: input.build_metadata !== null ? json(input.build_metadata) : null,
          updated_at: now(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRecord(row);
  }

  async updateSandboxStatus(
    input: UpdateSandboxStatusInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxProviderRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .updateTable('sandbox_provider')
      .set({
        status: input.status,
        status_reason: input.status_reason,
        build_metadata: input.build_metadata !== null ? json(input.build_metadata) : null,
        updated_at: now(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }
}
