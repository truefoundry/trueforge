import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type { TenantSettingManifest } from '../../../schemas/tenantSetting';
import type { ITenantSettingStore, TenantSettingRecord, UpsertTenantSettingInput } from '../../tenantSettingStore';
import { jsonbBind, jsonText } from '../sqlExpressions';
import type { Database } from '../types';

/** Projects JSONB manifest via JSON_RESULT_COLUMNS. */
function recordColumns(eb: ExpressionBuilder<Database, 'tenant_setting'>) {
  return ['tenant_id' as const, jsonText<TenantSettingManifest>(eb.ref('manifest')).as('manifest')];
}

export class SqliteTenantSettingStore implements ITenantSettingStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getTenantSetting(
    tenantId: string,
    transaction?: Transaction<Database>,
  ): Promise<TenantSettingRecord | undefined> {
    const db = transaction ?? this.#db;
    return await db
      .selectFrom('tenant_setting')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  async upsertTenantSetting(
    input: UpsertTenantSettingInput,
    transaction?: Transaction<Database>,
  ): Promise<TenantSettingRecord> {
    const db = transaction ?? this.#db;
    return await db
      .insertInto('tenant_setting')
      .values({
        tenant_id: input.tenant_id,
        manifest: jsonbBind(input.manifest),
      })
      .onConflict(oc =>
        oc.column('tenant_id').doUpdateSet({
          manifest: jsonbBind(input.manifest),
        }),
      )
      .returning(recordColumns)
      .executeTakeFirstOrThrow();
  }
}
