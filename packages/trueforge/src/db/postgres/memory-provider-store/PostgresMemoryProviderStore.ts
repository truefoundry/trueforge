import type { Kysely, Selectable, Transaction } from 'kysely';
import type { IMemoryProviderStore, MemoryProviderRecord, UpsertMemoryProviderInput } from '../../memoryProviderStore';
import { json, now } from '../sqlExpressions';
import type { Database, MemoryProviderTable } from '../types';

function toRecord(row: Selectable<MemoryProviderTable>): MemoryProviderRecord {
  return {
    tenant_id: row.tenant_id,
    manifest: row.manifest,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresMemoryProviderStore implements IMemoryProviderStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getProvider(tenantId: string, transaction?: Transaction<Database>): Promise<MemoryProviderRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db.selectFrom('memory_provider').selectAll().where('tenant_id', '=', tenantId).executeTakeFirst();
    return row ? toRecord(row) : undefined;
  }

  async upsertProvider(
    input: UpsertMemoryProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<MemoryProviderRecord> {
    const db = transaction ?? this.#db;
    const row = await db
      .insertInto('memory_provider')
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
