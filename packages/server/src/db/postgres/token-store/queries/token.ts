import type { OAuthToken } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import type { Database, OAuthToken as OAuthTokenRow } from '../../types';
import { json, now } from '../sqlExpressions';

/** Drops `undefined`-valued keys — required under `exactOptionalPropertyTypes` when an optional
 * source field (`string | undefined`) is copied into an optional target field (`string`). */
function omitUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

function toRow(token: OAuthToken): OAuthTokenRow {
  return omitUndefined({
    accessToken: token.accessToken,
    refreshToken: token.refreshToken,
    expiresAt: token.expiresAt.toISOString(),
    scope: token.scope,
  }) as unknown as OAuthTokenRow;
}

function fromRow(row: OAuthTokenRow): OAuthToken {
  return omitUndefined({
    accessToken: row.accessToken,
    refreshToken: row.refreshToken,
    expiresAt: new Date(row.expiresAt),
    scope: row.scope,
  }) as unknown as OAuthToken;
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
