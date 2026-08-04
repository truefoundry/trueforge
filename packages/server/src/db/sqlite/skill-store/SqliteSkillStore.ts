import type { ExpressionBuilder, Kysely } from 'kysely';
import type { SkillManifest } from '../../../schemas/skill';
import { type GetSkillInput, type ISkillStore, type SkillRecord, type UpsertSkillInput } from '../../skillStore';
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

export class SqliteSkillStore implements ISkillStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listSkills(tenantId: string): Promise<SkillRecord[]> {
    return await this.#db
      .selectFrom('skill')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .orderBy('name')
      .execute();
  }

  async getSkill(input: GetSkillInput): Promise<SkillRecord | undefined> {
    return await this.#db
      .selectFrom('skill')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
  }

  async upsertSkill(input: UpsertSkillInput): Promise<SkillRecord> {
    const timestamp = nowIso();
    return await this.#db
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
