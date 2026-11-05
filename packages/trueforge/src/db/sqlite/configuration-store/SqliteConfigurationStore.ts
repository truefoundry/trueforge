import { sql, type ExpressionBuilder, type Kysely, type Transaction } from 'kysely';
import {
  DEFAULT_CONFIGURATION_MANIFEST,
  hasEveryConfigurationSwitch,
  type ConfigurationFeature,
  type ConfigurationManifest,
} from '../../../schemas/configuration';
import type {
  ConfigurationRecord,
  GetOrCreateConfigurationInput,
  IConfigurationStore,
  UpsertConfigurationInput,
} from '../../configurationStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Projects JSONB manifest via JSON_RESULT_COLUMNS. */
function recordColumns(eb: ExpressionBuilder<Database, 'configuration'>) {
  return [
    'tenant_id' as const,
    jsonText<ConfigurationManifest>(eb.ref('manifest')).as('manifest'),
    'updated_at' as const,
  ];
}

/** Adds only the switches a row lacks, in one statement, so a concurrent save is never overwritten. */
async function seedMissingSwitches({
  db,
  record,
}: {
  db: Kysely<Database>;
  record: ConfigurationRecord;
}): Promise<ConfigurationRecord> {
  if (hasEveryConfigurationSwitch(record.manifest)) {
    return record;
  }
  return await db
    .updateTable('configuration')
    .set({ manifest: sql<string>`jsonb_patch(${jsonbBind(DEFAULT_CONFIGURATION_MANIFEST)}, manifest)` })
    .where('tenant_id', '=', record.tenant_id)
    .returning(recordColumns)
    .executeTakeFirstOrThrow();
}

export class SqliteConfigurationStore implements IConfigurationStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getConfiguration(
    tenantId: string,
    transaction?: Transaction<Database>,
  ): Promise<ConfigurationRecord | undefined> {
    const db = transaction ?? this.#db;
    const record = await db
      .selectFrom('configuration')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    return record === undefined ? undefined : await seedMissingSwitches({ db, record });
  }

  async upsertConfiguration(
    input: UpsertConfigurationInput,
    transaction?: Transaction<Database>,
  ): Promise<ConfigurationRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    return await db
      .insertInto('configuration')
      .values({
        tenant_id: input.tenant_id,
        manifest: jsonbBind(input.manifest),
        updated_at: timestamp,
      })
      .onConflict(oc =>
        oc.column('tenant_id').doUpdateSet({
          manifest: jsonbBind(input.manifest),
          updated_at: timestamp,
        }),
      )
      .returning(recordColumns)
      .executeTakeFirstOrThrow();
  }

  async getOrCreateConfiguration(
    input: GetOrCreateConfigurationInput,
    transaction?: Transaction<Database>,
  ): Promise<ConfigurationRecord> {
    const db = transaction ?? this.#db;
    const inserted = await db
      .insertInto('configuration')
      .values({
        tenant_id: input.tenant_id,
        manifest: jsonbBind(input.default_manifest),
        updated_at: nowIso(),
      })
      .onConflict(oc => oc.column('tenant_id').doNothing())
      .returning(recordColumns)
      .executeTakeFirst();
    if (inserted !== undefined) {
      return inserted;
    }
    // Lost the insert race: the row another writer stored wins.
    const existing = await db
      .selectFrom('configuration')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .executeTakeFirstOrThrow();
    return await seedMissingSwitches({ db, record: existing });
  }

  async listTenantIdsWithFeatureEnabled(
    feature: ConfigurationFeature,
    transaction?: Transaction<Database>,
  ): Promise<string[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('configuration')
      .select('tenant_id')
      .where(sql<boolean>`json_type(manifest, ${sql.lit(`$.${feature}.enabled`)}) IS 'true'`)
      .execute();
    return rows.map(row => row.tenant_id);
  }
}
