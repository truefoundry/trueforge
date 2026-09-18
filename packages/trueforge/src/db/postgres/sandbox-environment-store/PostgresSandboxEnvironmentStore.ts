import { CreatedBySubjectSchema, type TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import {
  decodeOffsetPageToken,
  paginateOffsetRows,
} from '@truefoundry/trueforge-core/agent-session/store/OffsetPageToken';
import { sql, type Kysely, type Selectable, type Transaction } from 'kysely';
import { newId } from '../../../utils/id';
import {
  parseStoredSandboxEnvironmentManifest,
  SandboxEnvironmentNameConflictError,
  type CreateSandboxEnvironmentInput,
  type DeleteSandboxEnvironmentInput,
  type GetOwnedIdsInput,
  type GetSandboxEnvironmentInput,
  type ISandboxEnvironmentStore,
  type ListSandboxEnvironmentsInput,
  type SandboxEnvironmentRecord,
  type UpdateSandboxEnvironmentInput,
} from '../../sandboxEnvironmentStore';
import { isUniqueViolation } from '../client';
import { json, now } from '../sqlExpressions';
import type { Database, SandboxEnvironmentTable } from '../types';

function toRecord(row: Selectable<SandboxEnvironmentTable>): SandboxEnvironmentRecord {
  return {
    id: row.id,
    tenant_id: row.tenant_id,
    name: row.name,
    description: row.description,
    manifest: parseStoredSandboxEnvironmentManifest(row.manifest),
    created_by_subject: CreatedBySubjectSchema.parse(row.created_by_subject),
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresSandboxEnvironmentStore implements ISandboxEnvironmentStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async createSandboxEnvironment(
    input: CreateSandboxEnvironmentInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentRecord> {
    const db = transaction ?? this.#db;
    try {
      const row = await db
        .insertInto('sandbox_environment')
        .values({
          id: newId(),
          tenant_id: input.tenant_id,
          name: input.name,
          description: input.description,
          manifest: json(input.manifest),
          created_by_subject: json(input.created_by_subject),
          created_at: now(),
          updated_at: now(),
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      return toRecord(row);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new SandboxEnvironmentNameConflictError(
          { tenant_id: input.tenant_id, name: input.name },
          { cause: error },
        );
      }
      throw error;
    }
  }

  async getSandboxEnvironment(
    input: GetSandboxEnvironmentInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentRecord | undefined> {
    const db = transaction ?? this.#db;
    let query = db.selectFrom('sandbox_environment').selectAll().where('tenant_id', '=', input.tenant_id);
    if ('id' in input) {
      query = query.where('id', '=', input.id);
    } else {
      query = query.where('name', '=', input.name);
    }
    const row = await query.executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async listSandboxEnvironments(
    input: ListSandboxEnvironmentsInput,
    transaction?: Transaction<Database>,
  ): Promise<{ data: SandboxEnvironmentRecord[]; pagination: TokenPagination }> {
    const offset = decodeOffsetPageToken(input.page_token);
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('sandbox_environment')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where(sql`created_by_subject->>'subject_id'`, '=', input.created_by_subject_id)
      .orderBy('created_at', 'desc')
      .orderBy('id')
      .limit(input.limit + 1)
      .offset(offset)
      .execute();
    const { data, pagination } = paginateOffsetRows(rows, input.limit, offset);
    return { data: data.map(toRecord), pagination };
  }

  async updateSandboxEnvironment(
    input: UpdateSandboxEnvironmentInput,
    transaction?: Transaction<Database>,
  ): Promise<SandboxEnvironmentRecord | undefined> {
    const db = transaction ?? this.#db;
    const row = await db
      .updateTable('sandbox_environment')
      .set({
        ...(input.description === undefined ? {} : { description: input.description }),
        manifest: json(input.manifest),
        updated_at: now(),
      })
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .returningAll()
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async deleteSandboxEnvironment(
    input: DeleteSandboxEnvironmentInput,
    transaction?: Transaction<Database>,
  ): Promise<boolean> {
    const db = transaction ?? this.#db;
    const result = await db
      .deleteFrom('sandbox_environment')
      .where('tenant_id', '=', input.tenant_id)
      .where('id', '=', input.id)
      .executeTakeFirst();
    return Number(result.numDeletedRows) > 0;
  }

  async getOwnedIds(input: GetOwnedIdsInput, transaction?: Transaction<Database>): Promise<readonly string[]> {
    if (input.ids.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('sandbox_environment')
      .select('id')
      .where('tenant_id', '=', input.tenant_id)
      .where('id', 'in', [...input.ids])
      .where(sql`created_by_subject->>'subject_id'`, '=', input.subject_id)
      .execute();
    return rows.map(row => row.id);
  }
}
