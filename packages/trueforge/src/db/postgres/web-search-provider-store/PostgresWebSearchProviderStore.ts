import type { Kysely, Selectable, Transaction } from 'kysely';
import {
  WebSearchProviderNameConflictError,
  type CreateWebSearchProviderInput,
  type GetWebSearchProviderForUpdateInput,
  type GetWebSearchProviderInput,
  type IWebSearchProviderStore,
  type ListWebSearchProvidersInput,
  type UpsertWebSearchProviderInput,
  type WebSearchProviderRecord,
} from '../../webSearchProviderStore';
import { isUniqueViolation } from '../client';
import { json, now } from '../sqlExpressions';
import type { Database, WebSearchProviderTable } from '../types';

function toRecord(row: Selectable<WebSearchProviderTable>): WebSearchProviderRecord {
  return {
    tenant_id: row.tenant_id,
    name: row.name,
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

  async listProviders(
    input: ListWebSearchProvidersInput,
    transaction?: Transaction<Database>,
  ): Promise<WebSearchProviderRecord[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('web_search_provider')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .orderBy('name')
      .execute();
    return rows.map(toRecord);
  }

  async getProvider(
    input: GetWebSearchProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<WebSearchProviderRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('web_search_provider')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
    return row ? toRecord(row) : undefined;
  }

  async getProviderForUpdate(
    input: GetWebSearchProviderForUpdateInput,
    transaction: Transaction<Database>,
  ): Promise<WebSearchProviderRecord | undefined> {
    const row = await transaction
      .selectFrom('web_search_provider')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .forUpdate()
      .executeTakeFirst();
    return row ? toRecord(row) : undefined;
  }

  async createProvider(
    input: CreateWebSearchProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<WebSearchProviderRecord> {
    const db = transaction ?? this.#db;
    try {
      const row = await db
        .insertInto('web_search_provider')
        .values({
          tenant_id: input.tenant_id,
          name: input.name,
          manifest: json(input.manifest),
          created_at: now(),
          updated_at: now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new WebSearchProviderNameConflictError(
          { tenant_id: input.tenant_id, name: input.name },
          { cause: error },
        );
      }
      throw error;
    }
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
        name: input.name,
        manifest: json(input.manifest),
        created_at: now(),
        updated_at: now(),
      })
      .onConflict(oc =>
        oc.columns(['tenant_id', 'name']).doUpdateSet({
          manifest: json(input.manifest),
          updated_at: now(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRecord(row);
  }
}
