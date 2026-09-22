import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type { WebSearchProviderManifest } from '../../../schemas/webSearchProvider';
import type {
  IWebSearchProviderStore,
  UpsertWebSearchProviderInput,
  WebSearchProviderRecord,
} from '../../webSearchProviderStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Projects JSONB manifest via JSON_RESULT_COLUMNS. */
function recordColumns(eb: ExpressionBuilder<Database, 'web_search_provider'>) {
  return [
    'tenant_id' as const,
    jsonText<WebSearchProviderManifest>(eb.ref('manifest')).as('manifest'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

export class SqliteWebSearchProviderStore implements IWebSearchProviderStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getProvider(
    tenantId: string,
    transaction?: Transaction<Database>,
  ): Promise<WebSearchProviderRecord | undefined> {
    const db = transaction ?? this.#db;
    return await db
      .selectFrom('web_search_provider')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  async upsertProvider(
    input: UpsertWebSearchProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<WebSearchProviderRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    return await db
      .insertInto('web_search_provider')
      .values({
        tenant_id: input.tenant_id,
        manifest: jsonbBind(input.manifest),
        created_at: timestamp,
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
