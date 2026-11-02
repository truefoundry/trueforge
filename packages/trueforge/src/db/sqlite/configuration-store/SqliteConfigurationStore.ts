import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type { ConfigurationManifest } from '../../../schemas/configuration';
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
    return await db
      .selectFrom('configuration')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
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
    return await db
      .selectFrom('configuration')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .executeTakeFirstOrThrow();
  }
}
