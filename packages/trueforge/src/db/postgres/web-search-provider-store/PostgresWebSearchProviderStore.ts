import type { Kysely, Selectable, Transaction } from 'kysely';
import type {
  IWebSearchProviderStore,
  UpsertWebSearchProviderInput,
  WebSearchProviderRecord,
} from '../../webSearchProviderStore';
import { json, now } from '../sqlExpressions';
import type { Database, WebSearchProviderTable } from '../types';

function toRecord(row: Selectable<WebSearchProviderTable>): WebSearchProviderRecord {
  return {
    tenant_id: row.tenant_id,
    manifest: row.manifest,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresWebSearchProviderStore implements IWebSearchProviderStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getProvider(
    tenantId: string,
    transaction?: Transaction<Database>,
  ): Promise<WebSearchProviderRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('web_search_provider')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    return row ? toRecord(row) : undefined;
  }

  async upsertProvider(
    input: UpsertWebSearchProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<WebSearchProviderRecord> {
    const db = transaction ?? this.#db;
    const row = await db
      .insertInto('web_search_provider')
      .values({
        tenant_id: input.tenant_id,
        manifest: json(input.manifest),
        created_at: now(),
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
