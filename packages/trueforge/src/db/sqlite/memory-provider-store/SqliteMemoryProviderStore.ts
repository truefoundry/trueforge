import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type { MemoryProviderManifest } from '../../../schemas/memoryProvider';
import type { IMemoryProviderStore, MemoryProviderRecord, UpsertMemoryProviderInput } from '../../memoryProviderStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Projects JSONB manifest via JSON_RESULT_COLUMNS. */
function recordColumns(eb: ExpressionBuilder<Database, 'memory_provider'>) {
  return [
    'tenant_id' as const,
    jsonText<MemoryProviderManifest>(eb.ref('manifest')).as('manifest'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

export class SqliteMemoryProviderStore implements IMemoryProviderStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getProvider(tenantId: string, transaction?: Transaction<Database>): Promise<MemoryProviderRecord | undefined> {
    const db = transaction ?? this.#db;
    return await db
      .selectFrom('memory_provider')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  async upsertProvider(
    input: UpsertMemoryProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<MemoryProviderRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    return await db
      .insertInto('memory_provider')
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
