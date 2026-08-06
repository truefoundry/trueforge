import type { Kysely } from 'kysely';
import type { IOAuthTokenStore, OAuthPendingAuthorization, OAuthToken } from '../../../mcp/auth/types';
import { fromStoredOAuthToken, toStoredOAuthToken } from '../../mcpServerStore';
import type { Database } from '../types';
import { consumePendingAuthorization, savePendingAuthorization } from './queries/pendingAuthorization';
import { deleteToken, getToken, getTokens, saveToken } from './queries/token';

export class PostgresOAuthTokenStore implements IOAuthTokenStore {
  constructor(private readonly db: Kysely<Database>) {}

  savePendingAuthorization(pending: OAuthPendingAuthorization): Promise<void> {
    return savePendingAuthorization(this.db, pending);
  }

  consumePendingAuthorization(params: { state: string }): Promise<OAuthPendingAuthorization | undefined> {
    return consumePendingAuthorization(this.db, params);
  }

  saveToken(params: { id: string; token: OAuthToken }): Promise<void> {
    return saveToken(this.db, { id: params.id, token: toStoredOAuthToken(params.token) });
  }

  async getToken(params: { id: string }): Promise<OAuthToken | undefined> {
    const stored = await getToken(this.db, params);
    return stored === undefined ? undefined : fromStoredOAuthToken(stored);
  }

  async getTokens(params: { ids: string[] }): Promise<Map<string, OAuthToken>> {
    const stored = await getTokens(this.db, params);
    return new Map([...stored].map(([id, token]) => [id, fromStoredOAuthToken(token)]));
  }

  deleteToken(params: { id: string }): Promise<void> {
    return deleteToken(this.db, params);
  }
}
