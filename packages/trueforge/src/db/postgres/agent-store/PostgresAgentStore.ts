import type { Kysely, Selectable, Transaction } from 'kysely';
import { ulid } from 'ulid';
import {
  AgentNameConflictError,
  parseStoredAgentSpec,
  type AgentRecord,
  type CreateAgentInput,
  type DeleteAgentInput,
  type GetAgentInput,
  type IAgentStore,
  type UpdateAgentInput,
} from '../../agentStore';
import { isUniqueViolation } from '../client';
import { json, now } from '../sqlExpressions';
import type { AgentTable, Database } from '../types';

function toRecord(row: Selectable<AgentTable>): AgentRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    manifest: parseStoredAgentSpec(row.manifest),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresAgentStore implements IAgentStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listAgents(tenantId: string, transaction?: Transaction<Database>): Promise<AgentRecord[]> {
    const db = transaction ?? this.#db;
    const rows = await db.selectFrom('agent').selectAll().where('tenant_id', '=', tenantId).orderBy('name').execute();
    return rows.map(toRecord);
  }

  async getAgent(input: GetAgentInput, transaction?: Transaction<Database>): Promise<AgentRecord | undefined> {
    const db = transaction ?? this.#db;
    let query = db.selectFrom('agent').selectAll().where('tenant_id', '=', input.tenant_id);
    if ('id' in input) {
      query = query.where('id', '=', input.id);
    } else {
      query = query.where('name', '=', input.name);
    }
    const row = await query.executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async createAgent(input: CreateAgentInput, transaction?: Transaction<Database>): Promise<AgentRecord> {
    const db = transaction ?? this.#db;
    try {
      const row = await db
        .insertInto('agent')
        .values({
          id: ulid().toLowerCase(),
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
        throw new AgentNameConflictError({ tenant_id: input.tenant_id, name: input.name }, { cause: error });
      }
      throw error;
    }
  }

  async updateAgent(input: UpdateAgentInput, transaction?: Transaction<Database>): Promise<AgentRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .updateTable('agent')
      .set({
        manifest: json(input.manifest),
        updated_at: now(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async deleteAgent(input: DeleteAgentInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db.deleteFrom('agent').where('tenant_id', '=', input.tenant_id).where('id', '=', input.id).execute();
  }
}
