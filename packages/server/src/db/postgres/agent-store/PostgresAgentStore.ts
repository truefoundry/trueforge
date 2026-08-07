import type { Kysely, Selectable } from 'kysely';
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

export class PostgresAgentStore implements IAgentStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listAgents(tenantId: string): Promise<AgentRecord[]> {
    const rows = await this.#db
      .selectFrom('agent')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('name')
      .execute();
    return rows.map(toRecord);
  }

  async getAgent(input: GetAgentInput): Promise<AgentRecord | undefined> {
    let query = this.#db.selectFrom('agent').selectAll().where('tenant_id', '=', input.tenant_id);
    if ('id' in input) {
      query = query.where('id', '=', input.id);
    } else {
      query = query.where('name', '=', input.name);
    }
    const row = await query.executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async createAgent(input: CreateAgentInput): Promise<AgentRecord> {
    try {
      const row = await this.#db
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

  async updateAgent(input: UpdateAgentInput): Promise<AgentRecord | undefined> {
    const row = await this.#db
      .updateTable('agent')
      .set({
        manifest: json(input.manifest),
        updated_at: now(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async deleteAgent(input: DeleteAgentInput): Promise<void> {
    await this.#db.deleteFrom('agent').where('tenant_id', '=', input.tenant_id).where('id', '=', input.id).execute();
  }
}
