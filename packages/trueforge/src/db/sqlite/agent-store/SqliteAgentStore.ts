import type { AgentSpec } from '@truefoundry/trueforge-core/agent-session';
import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import { EMPTY_AGENT_METADATA, type AgentMetadata } from '../../../schemas/agentMetadata';
import { newId } from '../../../utils/id';
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
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting JSONB columns as parsed JSON (see JSON_RESULT_COLUMNS). */
function recordColumns(eb: ExpressionBuilder<Database, 'agent'>) {
  return [
    'id' as const,
    'tenant_id' as const,
    'name' as const,
    jsonText<AgentSpec>(eb.ref('manifest')).as('manifest'),
    jsonText<AgentMetadata>(eb.ref('metadata')).as('metadata'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

function toRecord(row: {
  id: string;
  tenant_id: string;
  name: AgentRecord['name'];
  manifest: AgentSpec;
  metadata: AgentMetadata;
  created_at: string;
  updated_at: string;
}): AgentRecord {
  return { ...row, manifest: parseStoredAgentSpec(row.manifest) };
}

export class SqliteAgentStore implements IAgentStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listAgents(tenantId: string, transaction?: Transaction<Database>): Promise<AgentRecord[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('agent')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .orderBy('name')
      .execute();
    return rows.map(toRecord);
  }

  async getAgent(input: GetAgentInput, transaction?: Transaction<Database>): Promise<AgentRecord | undefined> {
    const db = transaction ?? this.#db;
    let query = db.selectFrom('agent').select(recordColumns).where('tenant_id', '=', input.tenant_id);
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
    const timestamp = nowIso();
    try {
      const row = await db
        .insertInto('agent')
        .values({
          id: newId(),
          tenant_id: input.tenant_id,
          name: input.name,
          manifest: jsonbBind(input.manifest),
          metadata: jsonbBind(EMPTY_AGENT_METADATA),
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returning(recordColumns)
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
    if (input.manifest === undefined && input.metadata === undefined) {
      throw new Error('updateAgent requires manifest and/or metadata');
    }
    const db = transaction ?? this.#db;
    const row = await db
      .updateTable('agent')
      .set({
        ...(input.manifest === undefined ? {} : { manifest: jsonbBind(input.manifest) }),
        ...(input.metadata === undefined ? {} : { metadata: jsonbBind(input.metadata) }),
        updated_at: nowIso(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .returning(recordColumns)
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async deleteAgent(input: DeleteAgentInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db.deleteFrom('agent').where('tenant_id', '=', input.tenant_id).where('id', '=', input.id).execute();
  }
}
