import type { OAuthClientRegistration } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import type { OAuthClient, OAuthServer } from '../../../mcpOAuthTypes';
import { json, now } from '../../sqlExpressions';
import type { Database } from '../../types';

export async function saveClient(
  db: Kysely<Database>,
  params: { id: string; registration: OAuthClientRegistration },
): Promise<void> {
  const { server, client } = params.registration;
  const oauthServer: OAuthServer = {
    authorizationEndpoint: server.authorizationEndpoint,
    tokenEndpoint: server.tokenEndpoint,
    ...(server.codeChallengeMethodsSupported !== null
      ? { codeChallengeMethodsSupported: server.codeChallengeMethodsSupported }
      : {}),
  };
  const oauthClient: OAuthClient = {
    clientId: client.clientId,
    ...(client.clientSecret !== null ? { clientSecret: client.clientSecret } : {}),
  };

  await db
    .updateTable('mcp_server')
    .set({
      oauth_server: json(oauthServer),
      oauth_client: json(oauthClient),
      updated_at: now(),
    })
    .where('id', '=', params.id)
    .execute();
}

export async function getClient(
  db: Kysely<Database>,
  params: { id: string },
): Promise<OAuthClientRegistration | undefined> {
  const row = await db
    .selectFrom('mcp_server')
    .select(['oauth_server', 'oauth_client'])
    .where('id', '=', params.id)
    .executeTakeFirst();

  if (row === undefined || row.oauth_server === null || row.oauth_client === null) {
    return undefined;
  }

  return {
    server: {
      authorizationEndpoint: row.oauth_server.authorizationEndpoint,
      tokenEndpoint: row.oauth_server.tokenEndpoint,
      codeChallengeMethodsSupported: row.oauth_server.codeChallengeMethodsSupported ?? null,
    },
    client: {
      clientId: row.oauth_client.clientId,
      clientSecret: row.oauth_client.clientSecret ?? null,
    },
  };
}

export async function deleteClient(db: Kysely<Database>, params: { id: string }): Promise<void> {
  await db
    .updateTable('mcp_server')
    .set({ oauth_server: null, oauth_client: null, updated_at: now() })
    .where('id', '=', params.id)
    .execute();
}
