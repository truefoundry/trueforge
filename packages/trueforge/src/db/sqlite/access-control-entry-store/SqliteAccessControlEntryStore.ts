import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type {
  GrantSessionAccessInput,
  IAccessControlEntryStore,
  ListSessionAccessInput,
  RevokeSessionAccessInput,
  SessionAccessRecord,
} from '../../accessControlEntryStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting the JSONB subject as parsed JSON (see JSON_RESULT_COLUMNS). */
function recordColumns(eb: ExpressionBuilder<Database, 'access_control_entry'>) {
  return [
    'tenant_id' as const,
    'session_id' as const,
    'subject_type' as const,
    'subject_id' as const,
    jsonText<CreatedBySubject>(eb.ref('granted_by_subject')).as('granted_by_subject'),
    'created_at' as const,
  ];
}

export class SqliteAccessControlEntryStore implements IAccessControlEntryStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async listSessionAccess(
    input: ListSessionAccessInput,
    transaction?: Transaction<Database>,
  ): Promise<SessionAccessRecord[]> {
    const db = transaction ?? this.#db;
    return await db
      .selectFrom('access_control_entry')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('session_id', '=', input.session_id)
      .orderBy('created_at')
      .orderBy('subject_id')
      .execute();
  }

  async grantSessionAccess(input: GrantSessionAccessInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    const timestamp = nowIso();
    await db
      .insertInto('access_control_entry')
      .values(
        input.subjects.map(subject => ({
          tenant_id: input.tenant_id,
          session_id: input.session_id,
          subject_type: subject.subject_type,
          subject_id: subject.subject_id,
          granted_by_subject: jsonbBind(input.granted_by_subject),
          created_at: timestamp,
        })),
      )
      .onConflict(oc => oc.columns(['tenant_id', 'session_id', 'subject_type', 'subject_id']).doNothing())
      .execute();
  }

  async revokeSessionAccess(input: RevokeSessionAccessInput, transaction?: Transaction<Database>): Promise<boolean> {
    const db = transaction ?? this.#db;
    const result = await db
      .deleteFrom('access_control_entry')
      .where('tenant_id', '=', input.tenant_id)
      .where('session_id', '=', input.session_id)
      .where('subject_type', '=', input.subject.subject_type)
      .where('subject_id', '=', input.subject.subject_id)
      .executeTakeFirst();
    return result.numDeletedRows > 0n;
  }
}
