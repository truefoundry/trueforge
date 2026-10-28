import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type {
  GrantSessionAccessInput,
  IAccessControlStore,
  ListSessionAccessInput,
  RevokeSessionAccessInput,
  SessionAccessRecord,
} from '../../accessControlStore';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';
import type { Database } from '../types';

/** Column list projecting the JSONB subject as parsed JSON (see JSON_RESULT_COLUMNS). */
function recordColumns(eb: ExpressionBuilder<Database, 'access_control'>) {
  return [
    'tenant_id' as const,
    'session_id' as const,
    'subject_type' as const,
    'subject_id' as const,
    jsonText<CreatedBySubject>(eb.ref('granted_by_subject')).as('granted_by_subject'),
    'created_at' as const,
  ];
}

export class SqliteAccessControlStore implements IAccessControlStore<Transaction<Database>> {
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
      .selectFrom('access_control')
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
      .insertInto('access_control')
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

  async revokeSessionAccess(input: RevokeSessionAccessInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db
      .deleteFrom('access_control')
      .where('tenant_id', '=', input.tenant_id)
      .where('session_id', '=', input.session_id)
      .where(eb =>
        eb.or(
          input.subjects.map(subject =>
            eb.and([eb('subject_type', '=', subject.subject_type), eb('subject_id', '=', subject.subject_id)]),
          ),
        ),
      )
      .execute();
  }
}
