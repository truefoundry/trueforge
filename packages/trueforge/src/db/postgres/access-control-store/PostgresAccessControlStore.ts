import type { Kysely, Transaction } from 'kysely';
import type {
  GrantSessionAccessInput,
  HasSessionAccessInput,
  IAccessControlStore,
  ListSessionAccessInput,
  ListTenantSharedSessionIdsInput,
  RevokeSessionAccessInput,
  SessionAccessRecord,
} from '../../accessControlStore';
import { json, now } from '../sqlExpressions';
import type { Database } from '../types';

export class PostgresAccessControlStore implements IAccessControlStore<Transaction<Database>> {
  readonly #db: Kysely<Database>;

  constructor(db: Kysely<Database>) {
    this.#db = db;
  }

  async hasSessionAccess(input: HasSessionAccessInput, transaction?: Transaction<Database>): Promise<boolean> {
    const db = transaction ?? this.#db;
    const { user_id } = input;
    const row = await db
      .selectFrom('access_control')
      .select(eb => eb.lit(1).as('found'))
      .where('tenant_id', '=', input.tenant_id)
      .where('session_id', '=', input.session_id)
      .where(eb =>
        eb.or([
          eb.and([eb('subject_type', '=', 'tenant'), eb('subject_id', '=', input.tenant_id)]),
          ...(user_id === undefined ? [] : [eb.and([eb('subject_type', '=', 'user'), eb('subject_id', '=', user_id)])]),
        ]),
      )
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  async listTenantSharedSessionIds(
    input: ListTenantSharedSessionIdsInput,
    transaction?: Transaction<Database>,
  ): Promise<string[]> {
    if (input.session_ids.length === 0) {
      return [];
    }
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('access_control')
      .select('session_id')
      .where('tenant_id', '=', input.tenant_id)
      .where('session_id', 'in', [...input.session_ids])
      .where('subject_type', '=', 'tenant')
      .where('subject_id', '=', input.tenant_id)
      .execute();
    return rows.map(row => row.session_id);
  }

  async listSessionAccess(
    input: ListSessionAccessInput,
    transaction?: Transaction<Database>,
  ): Promise<SessionAccessRecord[]> {
    const db = transaction ?? this.#db;
    const rows = await db
      .selectFrom('access_control')
      .selectAll()
      .where('tenant_id', '=', input.tenant_id)
      .where('session_id', '=', input.session_id)
      .orderBy('created_at')
      .orderBy('subject_id')
      .execute();
    return rows.map(row => ({
      tenant_id: row.tenant_id,
      session_id: row.session_id,
      subject_type: row.subject_type,
      subject_id: row.subject_id,
      granted_by_subject: row.granted_by_subject,
      created_at: row.created_at.toISOString(),
    }));
  }

  async grantSessionAccess(input: GrantSessionAccessInput, transaction?: Transaction<Database>): Promise<void> {
    const db = transaction ?? this.#db;
    await db
      .insertInto('access_control')
      .values(
        input.subjects.map(subject => ({
          tenant_id: input.tenant_id,
          session_id: input.session_id,
          subject_type: subject.subject_type,
          subject_id: subject.subject_id,
          granted_by_subject: json(input.granted_by_subject),
          created_at: now(),
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
