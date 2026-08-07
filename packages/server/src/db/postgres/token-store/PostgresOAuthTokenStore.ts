import type { Kysely, Transaction } from 'kysely';
import type { IOAuthTokenStore, OAuthPendingAuthorization, OAuthToken } from '../../../mcp/auth/types';
import { fromStoredOAuthToken, toStoredOAuthToken } from '../../mcpServerStore';
import type { Database } from '../types';
import { consumePendingAuthorization, savePendingAuthorization } from './queries/pendingAuthorization';
import { deleteToken, getToken, getTokens, saveToken } from './queries/token';

export class PostgresOAuthTokenStore implements IOAuthTokenStore<Transaction<Database>> {
  constructor(private readonly db: Kysely<Database>) {}

  savePendingAuthorization(pending: OAuthPendingAuthorization, transaction?: Transaction<Database>): Promise<void> {
    return savePendingAuthorization(transaction ?? this.db, pending);
  }

  consumePendingAuthorization(
    params: { state: string },
    transaction?: Transaction<Database>,
  ): Promise<OAuthPendingAuthorization | undefined> {
    return consumePendingAuthorization(transaction ?? this.db, params);
  }

  saveToken(params: { id: string; token: OAuthToken }, transaction?: Transaction<Database>): Promise<void> {
    return saveToken(transaction ?? this.db, { id: params.id, token: toStoredOAuthToken(params.token) });
  }

  async getToken(params: { id: string }, transaction?: Transaction<Database>): Promise<OAuthToken | undefined> {
    const stored = await getToken(transaction ?? this.db, params);
    return stored === undefined ? undefined : fromStoredOAuthToken(stored);
  }

  async getTokens(params: { ids: string[] }, transaction?: Transaction<Database>): Promise<Map<string, OAuthToken>> {
    const stored = await getTokens(transaction ?? this.db, params);
    return new Map([...stored].map(([id, token]) => [id, fromStoredOAuthToken(token)]));
  }

  deleteToken(params: { id: string }, transaction?: Transaction<Database>): Promise<void> {
    return deleteToken(transaction ?? this.db, params);
  }
}
