import type { Kysely, Selectable, Transaction } from 'kysely';
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
import { json, now } from '../sqlExpressions';
import type { Database, SkillTable } from '../types';

function toRecord(row: Selectable<SkillTable>): SkillRecord {
  return {
    tenant_id: row.tenant_id,
    name: row.name,
    manifest: row.manifest,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresSkillStore implements ISkillStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listSkills(input: ListSkillsInput, transaction?: Transaction<Database>): Promise<SkillRecord[]> {
    if (input.names?.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    let query = db.selectFrom('skill').selectAll().where('tenant_id', '=', input.tenant_id);
    if (input.names !== undefined) {
      query = query.where('name', 'in', [...input.names]);
    }
    const rows = await query.orderBy('name').execute();
    return rows.map(toRecord);
  }

  async getSkill(input: GetSkillInput, transaction?: Transaction<Database>): Promise<SkillRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .selectFrom('skill')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async createSkill(input: CreateSkillInput, transaction?: Transaction<Database>): Promise<SkillRecord> {
    const db = transaction ?? this.#db;
    try {
      const row = await db
        .insertInto('skill')
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
        throw new SkillNameConflictError({ tenant_id: input.tenant_id, name: input.name }, { cause: error });
      }
      throw error;
    }
  }

  async upsertSkill(input: UpsertSkillInput, transaction?: Transaction<Database>): Promise<SkillRecord> {
    const db = transaction ?? this.#db;
    const row = await db
      .insertInto('skill')
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
