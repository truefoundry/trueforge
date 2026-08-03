import { sql, type Kysely } from 'kysely';
import type { OAuthToken } from '../../../mcpOAuthTypes';
import { jsonbBind, jsonText, nowIso } from '../../sqlExpressions';
import type { Database } from '../../types';

export async function saveToken(db: Kysely<Database>, params: { id: string; token: OAuthToken }): Promise<void> {
  await db
    .insertInto('oauth_token')
    .values({
      oauth_server_id: params.id,
      token: jsonbBind(params.token),
      updated_at: nowIso(),
    })
    .onConflict(oc =>
      oc.column('oauth_server_id').doUpdateSet({
        token: sql`excluded.token`,
        updated_at: sql`excluded.updated_at`,
      }),
    )
    .execute();
}

export async function getToken(db: Kysely<Database>, params: { id: string }): Promise<OAuthToken | undefined> {
  const row = await db
    .selectFrom('oauth_token')
    .select(jsonText<OAuthToken>(sql.ref('token')).as('token'))
    .where('oauth_server_id', '=', params.id)
    .executeTakeFirst();

  return row === undefined ? undefined : row.token;
}

export async function deleteToken(db: Kysely<Database>, params: { id: string }): Promise<void> {
  await db.deleteFrom('oauth_token').where('oauth_server_id', '=', params.id).execute();
}
