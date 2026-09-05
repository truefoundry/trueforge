import type { AgentSpec, CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import { sql, type ExpressionBuilder, type Kysely, type Transaction } from 'kysely';
import { newId } from '../../../utils/id';
import {
  AgentExternalIdConflictError,
  AgentNameConflictError,
  parseStoredAgentSpec,
  type AgentExternalIdRow,
  type AgentRecord,
  type CreateAgentInput,
  type DeleteAgentInput,
  type GetAgentInput,
  type GetExternalIdsByIdsInput,
  type GetOwnedIdsInput,
  type IAgentStore,
  type ListAgentsInput,
  type UpdateAgentInput,
} from '../../agentStore';
import { parseStoredCreatedBySubject } from '../../createdBySubject';
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
    'external_id' as const,
    jsonText<CreatedBySubject>(eb.ref('created_by_subject')).as('created_by_subject'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

function toRecord(row: {
  id: string;
  tenant_id: string;
  name: AgentRecord['name'];
  manifest: AgentSpec;
  external_id: string | null;
  created_by_subject: CreatedBySubject;
  created_at: string;
  updated_at: string;
}): AgentRecord {
  return {
    ...row,
    manifest: parseStoredAgentSpec(row.manifest),
    created_by_subject: parseStoredCreatedBySubject(row.created_by_subject),
  };
}

export class SqliteAgentStore implements IAgentStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listAgents(input: ListAgentsInput, transaction?: Transaction<Database>): Promise<AgentRecord[]> {
    if (input.external_ids?.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    let query = db.selectFrom('agent').select(recordColumns).where('tenant_id', '=', input.tenant_id);
    if (input.external_ids !== undefined) {
      query = query.where('external_id', 'in', [...input.external_ids]);
    }
    const rows = await query.orderBy('name').execute();
    return rows.map(toRecord);
  }

  async getOwnedIds(input: GetOwnedIdsInput, transaction?: Transaction<Database>): Promise<readonly string[]> {
    if (input.ids.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('agent')
      .select('id')
      .where('tenant_id', '=', input.tenant_id)
      .where('id', 'in', [...input.ids])
      .where(sql`json_extract(created_by_subject, '$.subject_id')`, '=', input.subject_id)
      .execute();
    return rows.map(row => row.id);
  }

  async getExternalIdsByIds(
    input: GetExternalIdsByIdsInput,
    transaction?: Transaction<Database>,
  ): Promise<readonly AgentExternalIdRow[]> {
    if (input.ids.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('agent')
      .select(['id', 'external_id'])
      .where('tenant_id', '=', input.tenant_id)
      .where('id', 'in', [...input.ids])
      .where('external_id', 'is not', null)
      .execute();
    return rows.flatMap(row => (row.external_id ? [{ id: row.id, external_id: row.external_id }] : []));
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
          external_id: input.external_id,
          created_by_subject: jsonbBind(input.created_by_subject),
          created_at: timestamp,
          updated_at: timestamp,
        })
        .returning(recordColumns)
        .executeTakeFirstOrThrow();
      return toRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        await this.throwCreateUnique({
          error,
          tenant_id: input.tenant_id,
          name: input.name,
          external_id: input.external_id,
          ...(transaction === undefined ? {} : { transaction }),
        });
      }
      throw error;
    }
  }

  async updateAgent(input: UpdateAgentInput, transaction?: Transaction<Database>): Promise<AgentRecord | undefined> {
    if (input.manifest === undefined && input.external_id === undefined) {
      throw new Error('updateAgent requires manifest and/or external_id');
    }
    const db = transaction ?? this.#db;
    try {
      const row = await db
        .updateTable('agent')
        .set({
          ...(input.manifest === undefined ? {} : { manifest: jsonbBind(input.manifest) }),
          ...(input.external_id === undefined ? {} : { external_id: input.external_id }),
          updated_at: nowIso(),
        })
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.id)
        .returning(recordColumns)
        .executeTakeFirst();
      return row === undefined ? undefined : toRecord(row);
    } catch (error) {
      if (isUniqueViolation(error) && input.external_id) {
        throw new AgentExternalIdConflictError(
          { tenant_id: input.tenant_id, external_id: input.external_id },
          { cause: error },
        );
      }
      throw error;
    }
  }

  async deleteAgent(input: DeleteAgentInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db.deleteFrom('agent').where('tenant_id', '=', input.tenant_id).where('id', '=', input.id).execute();
  }

  /** Map unique violations to external_id vs name conflicts. */
  private async throwCreateUnique({
    error,
    tenant_id,
    name,
    external_id,
    transaction,
  }: {
    error: unknown;
    tenant_id: string;
    name: string;
    external_id: string | null;
    transaction?: Transaction<Database>;
  }): Promise<never> {
    if (external_id !== null) {
      const db = transaction ?? this.#db;
      const owner = await db
        .selectFrom('agent')
        .select('id')
        .where('tenant_id', '=', tenant_id)
        .where('external_id', '=', external_id)
        .executeTakeFirst();
      if (owner !== undefined) {
        throw new AgentExternalIdConflictError({ tenant_id, external_id }, { cause: error });
      }
    }
    throw new AgentNameConflictError({ tenant_id, name }, { cause: error });
  }
}
