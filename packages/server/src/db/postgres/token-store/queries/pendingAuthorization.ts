import type { OAuthPendingAuthorization } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import type { Database } from '../../types';
import { json, now } from '../sqlExpressions';

export async function savePendingAuthorization(
  db: Kysely<Database>,
  pending: OAuthPendingAuthorization,
): Promise<void> {
  await db
    .insertInto('oauth_pending_authorization')
    .values({
      id: pending.state,
      oauth_server_id: pending.server_id,
      auth_data: json(pending),
      created_at: now(),
    })
    .onConflict(oc =>
      oc.column('id').doUpdateSet({
        oauth_server_id: pending.server_id,
        auth_data: json(pending),
        created_at: now(),
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
    .select('auth_data')
    .where('id', '=', params.state)
    .executeTakeFirst();

  return row?.auth_data;
}
