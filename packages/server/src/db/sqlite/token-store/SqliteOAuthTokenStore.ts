import type { IOAuthTokenStore, OAuthPendingAuthorization, OAuthToken } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import type { Database } from '../types';
import { getPendingAuthorization, savePendingAuthorization } from './queries/pendingAuthorization';
import { deleteToken, getToken, saveToken } from './queries/token';

export class SqliteOAuthTokenStore implements IOAuthTokenStore {
  constructor(private readonly db: Kysely<Database>) {}

  savePendingAuthorization(pending: OAuthPendingAuthorization): Promise<void> {
    return savePendingAuthorization(this.db, pending);
  }

  getPendingAuthorization(params: { state: string }): Promise<OAuthPendingAuthorization | undefined> {
    return getPendingAuthorization(this.db, params);
  }

  saveToken(params: { id: string; token: OAuthToken }): Promise<void> {
    return saveToken(this.db, params);
  }

  getToken(params: { id: string }): Promise<OAuthToken | undefined> {
    return getToken(this.db, params);
  }

  deleteToken(params: { id: string }): Promise<void> {
    return deleteToken(this.db, params);
  }
}
