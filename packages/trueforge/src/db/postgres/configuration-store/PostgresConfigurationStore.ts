import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
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
import { json, now } from '../sqlExpressions';
import type { ConfigurationTable, Database } from '../types';

function toRecord(row: Selectable<ConfigurationTable>): ConfigurationRecord {
  return {
    tenant_id: row.tenant_id,
    manifest: row.manifest,
    updated_at: row.updated_at.toISOString(),
  };
}

/** Adds only the switches a row lacks, in one statement, so a concurrent save is never overwritten. */
async function seedMissingSwitches({
  db,
  row,
}: {
  db: Kysely<Database>;
  row: Selectable<ConfigurationTable>;
}): Promise<Selectable<ConfigurationTable>> {
  if (hasEveryConfigurationSwitch(row.manifest)) {
    return row;
  }
  return await db
    .updateTable('configuration')
    .set({ manifest: sql<ConfigurationManifest>`${json(DEFAULT_CONFIGURATION_MANIFEST)} || manifest` })
    .where('tenant_id', '=', row.tenant_id)
    .returningAll()
    .executeTakeFirstOrThrow();
}

export class PostgresConfigurationStore implements IConfigurationStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getConfiguration(
    tenantId: string,
    transaction?: Transaction<Database>,
  ): Promise<ConfigurationRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db.selectFrom('configuration').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();
    return row ? toRecord(await seedMissingSwitches({ db, row })) : undefined;
  }

  async upsertConfiguration(
    input: UpsertConfigurationInput,
    transaction?: Transaction<Database>,
  ): Promise<ConfigurationRecord> {
    const db = transaction ?? this.#db;
    const row = await db
      .insertInto('configuration')
      .values({
        tenant_id: input.tenant_id,
        manifest: json(input.manifest),
        updated_at: now(),
      })
      .onConflict(oc =>
        oc.column('tenant_id').doUpdateSet({
          manifest: json(input.manifest),
          updated_at: now(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRecord(row);
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
        manifest: json(input.default_manifest),
        updated_at: now(),
      })
      .onConflict(oc => oc.column('tenant_id').doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted !== undefined) {
      return toRecord(inserted);
    }
    // Lost the insert race: the row another writer stored wins.
    const existing = await db
      .selectFrom('configuration')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .executeTakeFirstOrThrow();
    return toRecord(await seedMissingSwitches({ db, row: existing }));
  }

  async listTenantIdsWithFeatureEnabled(
    feature: ConfigurationFeature,
    transaction?: Transaction<Database>,
  ): Promise<string[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('configuration')
      .select('tenant_id')
      .where(sql<boolean>`manifest -> ${sql.lit(feature)} ->> 'enabled' = 'true'`)
      .execute();
    return rows.map(row => row.tenant_id);
  }
}
