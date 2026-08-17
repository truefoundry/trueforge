import { sql, type Kysely } from 'kysely';
import type { OAuthToken } from '../../../mcpServerStore';
import { jsonbBind, jsonText, nowIso } from '../../sqlExpressions';
import type { Database } from '../../types';

export async function saveToken(
  db: Kysely<Database>,
  params: { id: string; userRef: string; token: OAuthToken },
): Promise<void> {
  await db
    .insertInto('oauth_token')
    .values({
      oauth_server_id: params.id,
      user_id: params.userRef,
      token: jsonbBind(params.token),
      updated_at: nowIso(),
    })
    .onConflict(oc =>
      oc.columns(['oauth_server_id', 'user_id']).doUpdateSet({
        token: sql`excluded.token`,
        updated_at: sql`excluded.updated_at`,
      }),
    )
    .execute();
}

export async function getToken(
  db: Kysely<Database>,
  params: { id: string; userRef: string },
): Promise<OAuthToken | undefined> {
  const row = await db
    .selectFrom('oauth_token')
    .select(jsonText<OAuthToken>(sql.ref('token')).as('token'))
    .where('oauth_server_id', '=', params.id)
    .where('user_id', '=', params.userRef)
    .executeTakeFirst();

  return row === undefined ? undefined : row.token;
}

export async function getTokens(
  db: Kysely<Database>,
  params: { ids: string[]; userRef: string },
): Promise<Map<string, OAuthToken>> {
  if (params.ids.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectFrom('oauth_token')
    .select(['oauth_server_id', jsonText<OAuthToken>(sql.ref('token')).as('token')])
    .where('oauth_server_id', 'in', params.ids)
    .where('user_id', '=', params.userRef)
    .execute();

  return new Map(rows.map(row => [row.oauth_server_id, row.token]));
}

export async function deleteToken(db: Kysely<Database>, params: { id: string; userRef: string }): Promise<void> {
  await db
    .deleteFrom('oauth_token')
    .where('oauth_server_id', '=', params.id)
    .where('user_id', '=', params.userRef)
    .execute();
}

export async function deleteTokensForServer(db: Kysely<Database>, params: { id: string }): Promise<void> {
  await db.deleteFrom('oauth_token').where('oauth_server_id', '=', params.id).execute();
}
