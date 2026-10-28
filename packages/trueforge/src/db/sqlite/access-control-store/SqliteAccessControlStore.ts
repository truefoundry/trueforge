import type { CreatedBySubject } from '@truefoundry/trueforge-core/agent-session';
import type { ExpressionBuilder, Kysely, Transaction } from 'kysely';
import type {
  AccessGrantRecord,
  CreateAccessGrantsInput,
  DeleteAccessGrantsInput,
  IAccessControlStore,
  ListAccessGrantsInput,
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

  async createAccessGrants(input: CreateAccessGrantsInput, transaction?: Transaction<Database>): Promise<void> {
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

  async listAccessGrants(
    input: ListAccessGrantsInput,
    transaction?: Transaction<Database>,
  ): Promise<AccessGrantRecord[]> {
    const { subjects } = input;
    if (input.session_ids.length === 0 || subjects?.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    let query = db
      .selectFrom('access_control')
      .select(recordColumns)
      .where('tenant_id', '=', input.tenant_id)
      .where('session_id', 'in', [...input.session_ids]);
    if (subjects !== undefined) {
      query = query.where(eb =>
        eb.or(
          subjects.map(subject =>
            eb.and([eb('subject_type', '=', subject.subject_type), eb('subject_id', '=', subject.subject_id)]),
          ),
        ),
      );
    }
    return await query.orderBy('session_id').orderBy('created_at').orderBy('subject_id').execute();
  }

  async deleteAccessGrants(input: DeleteAccessGrantsInput, transaction?: Transaction<Database>): Promise<void> {
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
