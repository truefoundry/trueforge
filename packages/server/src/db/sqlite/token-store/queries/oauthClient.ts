import type { OAuthClientRecord } from '@truefoundry/utils/core';
import { sql, type Kysely } from 'kysely';
import type { OAuthClient, OAuthServer } from '../../../mcpOAuthTypes';
import { jsonbBind, jsonText, nowIso } from '../../sqlExpressions';
import type { Database } from '../../types';

export async function saveClient(
  db: Kysely<Database>,
  params: { id: string; record: OAuthClientRecord },
): Promise<void> {
  const { record } = params;
  const oauthServer: OAuthServer = {
    authorizationEndpoint: record.authorizationEndpoint,
    tokenEndpoint: record.tokenEndpoint,
    ...(record.codeChallengeMethodsSupported !== null
      ? { codeChallengeMethodsSupported: record.codeChallengeMethodsSupported }
      : {}),
  };
  const oauthClient: OAuthClient = {
    clientId: record.clientId,
    ...(record.clientSecret !== null ? { clientSecret: record.clientSecret } : {}),
  };

  await db
    .updateTable('mcp_server')
    .set({
      oauth_server: jsonbBind(oauthServer),
      oauth_client: jsonbBind(oauthClient),
      updated_at: nowIso(),
    })
    .where('id', '=', params.id)
    .execute();
}

export async function getClient(db: Kysely<Database>, params: { id: string }): Promise<OAuthClientRecord | undefined> {
  const row = await db
    .selectFrom('mcp_server')
    .select([
      jsonText<OAuthServer | null>(sql.ref('oauth_server')).as('oauth_server'),
      jsonText<OAuthClient | null>(sql.ref('oauth_client')).as('oauth_client'),
    ])
    .where('id', '=', params.id)
    .executeTakeFirst();

  if (row === undefined || row.oauth_server === null || row.oauth_client === null) {
    return undefined;
  }

  return {
    clientId: row.oauth_client.clientId,
    clientSecret: row.oauth_client.clientSecret ?? null,
    authorizationEndpoint: row.oauth_server.authorizationEndpoint,
    tokenEndpoint: row.oauth_server.tokenEndpoint,
    codeChallengeMethodsSupported: row.oauth_server.codeChallengeMethodsSupported ?? null,
  };
}

export async function deleteClient(db: Kysely<Database>, params: { id: string }): Promise<void> {
  await db
    .updateTable('mcp_server')
    .set({ oauth_server: null, oauth_client: null, updated_at: nowIso() })
    .where('id', '=', params.id)
    .execute();
}
