import type { OAuthPendingAuthorization } from '@truefoundry/utils/core';
import { sql, type Kysely } from 'kysely';
import type { Database } from '../../types';
import { jsonbBind, jsonText, nowIso } from '../sqlExpressions';

export async function savePendingAuthorization(
  db: Kysely<Database>,
  pending: OAuthPendingAuthorization,
): Promise<void> {
  await db
    .insertInto('oauth_pending_authorization')
    .values({
      id: pending.state,
      oauth_server_id: pending.server_id,
      auth_data: jsonbBind(pending),
      created_at: nowIso(),
    })
    .onConflict(oc =>
      oc.column('id').doUpdateSet({
        oauth_server_id: sql`excluded.oauth_server_id`,
        auth_data: sql`excluded.auth_data`,
        created_at: sql`excluded.created_at`,
      }),
    )
    .execute();
}

export async function getPendingAuthorization(
  db: Kysely<Database>,
  params: { state: string },
): Promise<OAuthPendingAuthorization | undefined> {
  const row = await db
    .selectFrom('oauth_pending_authorization')
    .select(jsonText<OAuthPendingAuthorization>(sql.ref('auth_data')).as('auth_data'))
    .where('id', '=', params.state)
    .executeTakeFirst();

  return row?.auth_data;
}
