import type { Kysely, Selectable } from 'kysely';
import {
  type ISandboxProviderStore,
  type SandboxProviderRecord,
  type UpsertSandboxProviderInput,
} from '../../sandboxProviderStore';
import { json, now } from '../sqlExpressions';
import type { Database, SandboxProviderTable } from '../types';

function toRecord(row: Selectable<SandboxProviderTable>): SandboxProviderRecord {
  return {
    tenant_id: row.tenant_id,
    manifest: row.manifest,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
  };
}

export class PostgresSandboxProviderStore implements ISandboxProviderStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getSandboxProvider(tenantId: string): Promise<SandboxProviderRecord | undefined> {
    const row = await this.#db
      .selectFrom('sandbox_provider')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    return row === undefined ? undefined : toRecord(row);
  }

  async upsertSandboxProvider(input: UpsertSandboxProviderInput): Promise<SandboxProviderRecord> {
    const row = await this.#db
      .insertInto('sandbox_provider')
      .values({
        tenant_id: input.tenant_id,
        manifest: json(input.manifest),
        created_at: now(),
        updated_at: now(),
      })
      .onConflict(oc =>
        oc.columns(['tenant_id']).doUpdateSet({
          manifest: json(input.manifest),
          updated_at: now(),
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
    return toRecord(row);
  }
}
