import type { ExpressionBuilder, Kysely } from 'kysely';
import type { SandboxProviderManifest } from '../../../schemas/sandboxProvider';
import {
  type ISandboxProviderStore,
  type SandboxProviderRecord,
  type UpsertSandboxProviderInput,
} from '../../sandboxProviderStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting the JSONB manifest as parsed JSON (see JSON_RESULT_COLUMNS). */
function recordColumns(eb: ExpressionBuilder<Database, 'sandbox_provider'>) {
  return [
    'tenant_id' as const,
    jsonText<SandboxProviderManifest>(eb.ref('manifest')).as('manifest'),
    'created_at' as const,
    'updated_at' as const,
  ];
}

export class SqliteSandboxProviderStore implements ISandboxProviderStore {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async getSandboxProvider(tenantId: string): Promise<SandboxProviderRecord | undefined> {
    return await this.#db
      .selectFrom('sandbox_provider')
      .select(recordColumns)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
  }

  async upsertSandboxProvider(input: UpsertSandboxProviderInput): Promise<SandboxProviderRecord> {
    const timestamp = nowIso();
    return await this.#db
      .insertInto('sandbox_provider')
      .values({
        tenant_id: input.tenant_id,
        manifest: jsonbBind(input.manifest),
        created_at: timestamp,
        updated_at: timestamp,
      })
      .onConflict(oc =>
        oc.columns(['tenant_id']).doUpdateSet({
          manifest: jsonbBind(input.manifest),
          updated_at: timestamp,
        }),
      )
      .returning(recordColumns)
      .executeTakeFirstOrThrow();
  }
}
