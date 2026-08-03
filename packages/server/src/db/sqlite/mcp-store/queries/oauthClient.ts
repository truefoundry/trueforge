import type { OAuthClientRecord } from '@truefoundry/utils/core';
import { sql, type Kysely } from 'kysely';
import type { OAuthClient, OAuthServer } from '../../../mcpOAuthTypes';
import { jsonbBind, jsonText, nowIso } from '../../sqlExpressions';
import type { Database } from '../../types';

export async function saveClient(
  db: Kysely<Database>,
  params: { id: string; record: OAuthClientRecord },
): Promise<void> {
  const { server, client } = params.record;
  const oauthServer: OAuthServer = {
    authorizationEndpoint: server.authorizationEndpoint,
    tokenEndpoint: server.tokenEndpoint,
    codeChallengeMethodsSupported: server.codeChallengeMethodsSupported,
  };
  const oauthClient: OAuthClient = {
    clientId: client.clientId,
    clientSecret: client.clientSecret,
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
    server: {
      authorizationEndpoint: row.oauth_server.authorizationEndpoint,
      tokenEndpoint: row.oauth_server.tokenEndpoint,
      codeChallengeMethodsSupported: row.oauth_server.codeChallengeMethodsSupported,
    },
    client: {
      clientId: row.oauth_client.clientId,
      clientSecret: row.oauth_client.clientSecret,
    },
  };
}
