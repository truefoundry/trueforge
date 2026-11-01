import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type { ConfigurationsManifest } from '../../../schemas/configurations';
import type { ConfigurationRecord, IConfigurationStore, UpsertConfigurationInput } from '../../configurationStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Projects JSONB manifest via JSON_RESULT_COLUMNS. */
function recordColumns(eb: ExpressionBuilder<Database, 'configuration'>) {
  return [
    'tenant_id' as const,
    jsonText<ConfigurationsManifest>(eb.ref('manifest')).as('manifest'),
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
}
