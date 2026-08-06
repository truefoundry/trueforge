import type { AgentSpec } from '@truefoundry/utils-core/agent-session';
import type { ExpressionBuilder, Kysely } from 'kysely';
import { ulid } from 'ulid';
import {
  AgentNameConflictError,
  type AgentRecord,
  type CreateAgentInput,
  type GetAgentInput,
  type IAgentStore,
  type UpdateAgentInput,
} from '../../agentStore';
import { isUniqueViolation } from '../client';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting the JSONB manifest as parsed JSON (see JSON_RESULT_COLUMNS). */
function recordColumns(eb: ExpressionBuilder<Database, 'agent'>) {
  return [
    'id' as const,
    'tenant_id' as const,
    'name' as const,
    jsonText<AgentSpec>(eb.ref('manifest')).as('manifest'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

export class SqliteAgentStore implements IAgentStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listAgents(tenantId: string): Promise<AgentRecord[]> {
    return await this.#db
      .selectFrom('agent')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .orderBy('name')
      .execute();
  }

  async getAgent(input: GetAgentInput): Promise<AgentRecord | undefined> {
    let query = this.#db.selectFrom('agent').select(recordColumns).where('tenant_id', '=', input.tenant_id);
    if ('id' in input) {
      query = query.where('id', '=', input.id);
    } else {
      query = query.where('name', '=', input.name);
    }
    return await query.executeTakeFirst();
  }

  async createAgent(input: CreateAgentInput): Promise<AgentRecord> {
    const timestamp = nowIso();
    try {
      return await this.#db
        .insertInto('agent')
        .values({
          id: ulid().toLowerCase(),
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
        throw new AgentNameConflictError({ tenant_id: input.tenant_id, name: input.name }, { cause: error });
      }
      throw error;
    }
  }

  async updateAgent(input: UpdateAgentInput): Promise<AgentRecord | undefined> {
    return await this.#db
      .updateTable('agent')
      .set({
        manifest: jsonbBind(input.manifest),
        updated_at: nowIso(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('name', '=', input.name)
      .returning(recordColumns)
      .executeTakeFirst();
  }
}
