import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
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
import { AGENT_EXTERNAL_ID_UQ } from '../../indexes';
import { isPgConstraint, isUniqueViolation } from '../client';
import { json, now } from '../sqlExpressions';
import type { AgentTable, Database } from '../types';

function toRecord(row: Selectable<AgentTable>): AgentRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    manifest: parseStoredAgentSpec(row.manifest),
    external_id: row.external_id,
    created_by_subject: parseStoredCreatedBySubject(row.created_by_subject),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

/** Map unique violations to external_id vs name conflicts. */
function throwAgentUniqueViolation({
  error,
  tenant_id,
  name,
  external_id,
}: {
  error: unknown;
  tenant_id: string;
  name: string;
  external_id: string | null;
}): never {
  if (isPgConstraint(error, AGENT_EXTERNAL_ID_UQ) && external_id) {
    throw new AgentExternalIdConflictError({ tenant_id, external_id }, { cause: error });
  }
  throw new AgentNameConflictError({ tenant_id, name }, { cause: error });
}

export class PostgresAgentStore implements IAgentStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listAgents(input: ListAgentsInput, transaction?: Transaction<Database>): Promise<AgentRecord[]> {
    if (input.external_ids?.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    let query = db.selectFrom('agent').selectAll().where('tenant_id', '=', input.tenant_id);
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
      .where(sql`created_by_subject->>'subject_id'`, '=', input.subject_id)
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
          id: newId(),
          tenant_id: input.tenant_id,
          name: input.name,
          manifest: json(input.manifest),
          external_id: input.external_id,
          created_by_subject: json(input.created_by_subject),
          created_at: now(),
          updated_at: now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throwAgentUniqueViolation({
          error,
          tenant_id: input.tenant_id,
          name: input.name,
          external_id: input.external_id,
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
          ...(input.manifest === undefined ? {} : { manifest: json(input.manifest) }),
          ...(input.external_id === undefined ? {} : { external_id: input.external_id }),
          updated_at: now(),
        })
        .where('tenant_id', '=', input.tenant_id)
        .where('id', '=', input.id)
        .returningAll()
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
}
