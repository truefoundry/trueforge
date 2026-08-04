import type { IOAuthTokenStore, OAuthPendingAuthorization, OAuthToken } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import { fromStoredOAuthToken, toStoredOAuthToken } from '../../mcpOAuthTypes';
import type { Database } from '../types';
import { consumePendingAuthorization, savePendingAuthorization } from './queries/pendingAuthorization';
import { deleteToken, getToken, saveToken } from './queries/token';

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

  deleteToken(params: { id: string }): Promise<void> {
    return deleteToken(this.db, params);
  }
}
