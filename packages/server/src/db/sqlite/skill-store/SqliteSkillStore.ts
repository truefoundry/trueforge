import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type { SkillManifest } from '../../../schemas/skill';
import {
  SkillNameConflictError,
  type CreateSkillInput,
  type GetSkillInput,
  type ISkillStore,
  type ListSkillsInput,
  type SkillRecord,
  type UpsertSkillInput,
} from '../../skillStore';
import { isUniqueViolation } from '../client';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting the JSONB manifest as parsed JSON (see JSON_RESULT_COLUMNS). */
function recordColumns(eb: ExpressionBuilder<Database, 'skill'>) {
  return [
    'tenant_id' as const,
    'name' as const,
    jsonText<SkillManifest>(eb.ref('manifest')).as('manifest'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

export class SqliteSkillStore implements ISkillStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listSkills(input: ListSkillsInput, transaction?: Transaction<Database>): Promise<SkillRecord[]> {
    if (input.names?.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    let query = db.selectFrom('skill').select(recordColumns).where('tenant_id', '=', input.tenant_id);
    if (input.names !== undefined) {
      query = query.where('name', 'in', [...input.names]);
    }
    return await query.orderBy('name').execute();
  }

  async getSkill(input: GetSkillInput, transaction?: Transaction<Database>): Promise<SkillRecord | undefined> {
    const db = transaction ?? this.#db;
    return await db
      .selectFrom('skill')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
  }

  async createSkill(input: CreateSkillInput, transaction?: Transaction<Database>): Promise<SkillRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    try {
      return await db
        .insertInto('skill')
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
        throw new SkillNameConflictError({ tenant_id: input.tenant_id, name: input.name }, { cause: error });
      }
      throw error;
    }
  }

  async upsertSkill(input: UpsertSkillInput, transaction?: Transaction<Database>): Promise<SkillRecord> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    return await db
      .insertInto('skill')
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
}
