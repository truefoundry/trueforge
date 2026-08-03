import type { OAuthToken } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import { json, now } from '../../sqlExpressions';
import type { Database, OAuthToken as OAuthTokenRow } from '../../types';

// Both `OAuthToken` (harness domain type) and `OAuthTokenRow` (this DB's JSONB shape) declare
// their optional fields as `T | undefined`, not just `T`, so these plain object literals
// type-check under `exactOptionalPropertyTypes` with no runtime undefined-stripping step —
// `JSON.stringify` (inside `json()`) drops undefined-valued keys either way.

function toRow(token: OAuthToken): OAuthTokenRow {
  return {
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt.toISOString(),
    scope: token.scope,
  };
}

function fromRow(row: OAuthTokenRow): OAuthToken {
  return {
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: new Date(row.expiresAt),
    scope: row.scope,
  };
}

export async function saveToken(db: Kysely<Database>, params: { server_id: string; token: OAuthToken }): Promise<void> {
  const row = json(toRow(params.token));
  await db
    .insertInto('oauth_token')
    .values({
      oauth_server_id: params.server_id,
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

export async function getToken(db: Kysely<Database>, params: { server_id: string }): Promise<OAuthToken | undefined> {
  const row = await db
    .selectFrom('oauth_token')
    .select('token')
    .where('oauth_server_id', '=', params.server_id)
    .executeTakeFirst();

  return row === undefined ? undefined : fromRow(row.token);
}
