import type { Kysely, Selectable } from 'kysely';
import { ulid } from 'ulid';
import {
  AgentNameConflictError,
  type AgentRecord,
  type CreateAgentInput,
  type GetAgentByIdInput,
  type GetAgentByNameInput,
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
    manifest: row.manifest,
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

  async getAgentById(input: GetAgentByIdInput): Promise<AgentRecord | undefined> {
    const row = await this.#db
      .selectFrom('agent')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async getAgentByName(input: GetAgentByNameInput): Promise<AgentRecord | undefined> {
    const row = await this.#db
      .selectFrom('agent')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .executeTakeFirst();
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
    try {
      const row = await this.#db
        .updateTable('agent')
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.manifest !== undefined ? { manifest: json(input.manifest) } : {}),
          updated_at: now(),
        })
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.id)
        .returningAll()
        .executeTakeFirst();
      return row === undefined ? undefined : toRecord(row);
    } catch (error) {
      if (isUniqueViolation(error) && input.name !== undefined) {
        throw new AgentNameConflictError({ tenant_id: input.tenant_id, name: input.name }, { cause: error });
      }
      throw error;
    }
  }
}
