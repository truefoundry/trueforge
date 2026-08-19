import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type { AvailableModel, ModelProviderManifest } from '../../../schemas/modelProvider';
import {
  flattenProviderModels,
  ModelProviderNameConflictError,
  type CreateModelProviderInput,
  type GetModelProviderInput,
  type IModelProviderStore,
  type ModelProviderRecord,
  type UpsertModelProviderInput,
} from '../../modelProviderStore';
import { isUniqueViolation } from '../client';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting the JSONB manifest as parsed JSON (see JSON_RESULT_COLUMNS). */
function recordColumns(eb: ExpressionBuilder<Database, 'model_provider'>) {
  return [
    'tenant_id' as const,
    'name' as const,
    jsonText<ModelProviderManifest>(eb.ref('manifest')).as('manifest'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

export class SqliteModelProviderStore implements IModelProviderStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listProviders(tenantId: string, transaction?: Transaction<Database>): Promise<ModelProviderRecord[]> {
    const db = transaction ?? this.#db;
    return await db
      .selectFrom('model_provider')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .orderBy('name')
      .execute();
  }

  async getProvider(
    input: GetModelProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<ModelProviderRecord | undefined> {
    const db = transaction ?? this.#db;
    return await db
      .selectFrom('model_provider')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
  }

  /**
   * SQLite has no row-level FOR UPDATE; the required write transaction (BEGIN IMMEDIATE)
   * serializes concurrent writers so RMW of secrets stays consistent.
   */
  async getProviderForUpdate(
    input: GetModelProviderInput,
    transaction: Transaction<Database>,
  ): Promise<ModelProviderRecord | undefined> {
    return await transaction
      .selectFrom('model_provider')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
  }

  async createProvider(
    input: CreateModelProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<ModelProviderRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    try {
      return await db
        .insertInto('model_provider')
        .values({
          tenant_id: input.tenant_id,
          name: input.name,
          manifest: jsonbBind(input.manifest),
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returning(recordColumns)
        .executeTakeFirstOrThrow();
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ModelProviderNameConflictError({ tenant_id: input.tenant_id, name: input.name }, { cause: error });
      }
      throw error;
    }
  }

  async upsertProvider(
    input: UpsertModelProviderInput,
    transaction?: Transaction<Database>,
  ): Promise<ModelProviderRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    return await db
      .insertInto('model_provider')
      .values({
        tenant_id: input.tenant_id,
        name: input.name,
        manifest: jsonbBind(input.manifest),
        created_at: timestamp,
        updated_at: timestamp,
      })
      .onConflict(oc =>
        oc.columns(['tenant_id', 'name']).doUpdateSet({
          manifest: jsonbBind(input.manifest),
          updated_at: timestamp,
        }),
      )
      .returning(recordColumns)
      .executeTakeFirstOrThrow();
  }

  async listModels(tenantId: string, transaction?: Transaction<Database>): Promise<AvailableModel[]> {
    return flattenProviderModels(await this.listProviders(tenantId, transaction));
  }
}
