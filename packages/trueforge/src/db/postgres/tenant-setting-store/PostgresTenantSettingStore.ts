import type { Kysely, Selectable, Transaction } from 'kysely';
import type { ITenantSettingStore, TenantSettingRecord, UpsertTenantSettingInput } from '../../tenantSettingStore';
import { json } from '../sqlExpressions';
import type { Database, TenantSettingTable } from '../types';

function toRecord(row: Selectable<TenantSettingTable>): TenantSettingRecord {
  return {
    tenant_id: row.tenant_id,
    manifest: row.manifest,
  };
}

export class PostgresTenantSettingStore implements ITenantSettingStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getTenantSetting(
    tenantId: string,
    transaction?: Transaction<Database>,
  ): Promise<TenantSettingRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db.selectFrom('tenant_setting').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();
    return row ? toRecord(row) : undefined;
  }

  async upsertTenantSetting(
    input: UpsertTenantSettingInput,
    transaction?: Transaction<Database>,
  ): Promise<TenantSettingRecord> {
    const db = transaction ?? this.#db;
    const row = await db
      .insertInto('tenant_setting')
      .values({
        tenant_id: input.tenant_id,
        manifest: json(input.manifest),
      })
      .onConflict(oc =>
        oc.column('tenant_id').doUpdateSet({
          manifest: json(input.manifest),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRecord(row);
  }
}
