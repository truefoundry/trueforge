import type { Kysely, Selectable, Transaction } from 'kysely';
import type { ConfigurationRecord, IConfigurationStore, UpsertConfigurationInput } from '../../configurationStore';
import { json, now } from '../sqlExpressions';
import type { ConfigurationTable, Database } from '../types';

function toRecord(row: Selectable<ConfigurationTable>): ConfigurationRecord {
  return {
    tenant_id: row.tenant_id,
    manifest: row.manifest,
    updated_at: row.updated_at.toISOString(),
  };
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
    return row ? toRecord(row) : undefined;
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
}
