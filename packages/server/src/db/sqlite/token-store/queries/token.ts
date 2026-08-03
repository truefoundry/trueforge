import type { OAuthToken } from '@truefoundry/utils/core';
import { sql, type Kysely } from 'kysely';
import type { McpOAuthToken as OAuthTokenRow } from '../../../mcpOAuthTypes';
import { jsonbBind, jsonText, nowIso } from '../../sqlExpressions';
import type { Database } from '../../types';

// DB row (`McpOAuthToken`, `?:` for absence) and harness domain (`OAuthToken`, `null` for
// absence) use different conventions on purpose — see mcpOAuthTypes.ts / IOAuthTokenStore.ts doc
// comments — so null<->undefined is converted explicitly at this boundary.

function toRow(token: OAuthToken): OAuthTokenRow {
  return {
    accessToken: token.accessToken,
    ...(token.refreshToken !== null ? { refreshToken: token.refreshToken } : {}),
    expiresAt: token.expiresAt,
    ...(token.scope !== null ? { scope: token.scope } : {}),
  };
}

function fromRow(row: OAuthTokenRow): OAuthToken {
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken ?? null,
    expiresAt: row.expiresAt,
    scope: row.scope ?? null,
  };
}

export async function saveToken(db: Kysely<Database>, params: { id: string; token: OAuthToken }): Promise<void> {
  await db
    .insertInto('oauth_token')
    .values({
      oauth_server_id: params.id,
      token: jsonbBind(toRow(params.token)),
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
    .select(jsonText<OAuthTokenRow>(sql.ref('token')).as('token'))
    .where('oauth_server_id', '=', params.id)
    .executeTakeFirst();

  return row === undefined ? undefined : fromRow(row.token);
}

export async function deleteToken(db: Kysely<Database>, params: { id: string }): Promise<void> {
  await db.deleteFrom('oauth_token').where('oauth_server_id', '=', params.id).execute();
}
