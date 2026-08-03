import type { OAuthToken } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import type { McpOAuthToken as OAuthTokenRow } from '../../../mcpOAuthTypes';
import { json, now } from '../../sqlExpressions';
import type { Database } from '../../types';

function toRow(token: OAuthToken): OAuthTokenRow {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt,
    scope: token.scope,
  };
}

function fromRow(row: OAuthTokenRow): OAuthToken {
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: row.expiresAt,
    scope: row.scope,
  };
}

export async function saveToken(db: Kysely<Database>, params: { id: string; token: OAuthToken }): Promise<void> {
  const row = json(toRow(params.token));
  await db
    .insertInto('oauth_token')
    .values({
      oauth_server_id: params.id,
      token: row,
      updated_at: now(),
    })
    .onConflict(oc =>
      oc.column('oauth_server_id').doUpdateSet({
        token: row,
        updated_at: now(),
      }),
    )
    .execute();
}

export async function getToken(db: Kysely<Database>, params: { id: string }): Promise<OAuthToken | undefined> {
  const row = await db
    .selectFrom('oauth_token')
    .select('token')
    .where('oauth_server_id', '=', params.id)
    .executeTakeFirst();

  return row === undefined ? undefined : fromRow(row.token);
}

export async function deleteToken(db: Kysely<Database>, params: { id: string }): Promise<void> {
  await db.deleteFrom('oauth_token').where('oauth_server_id', '=', params.id).execute();
}
