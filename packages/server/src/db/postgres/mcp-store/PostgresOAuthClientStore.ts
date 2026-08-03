import type { IOAuthClientStore, OAuthClientRecord } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import type { Database } from '../types';
import { getClient, saveClient } from './queries/oauthClient';
export class PostgresMCPOAuthClientStore implements IOAuthClientStore {
  constructor(private readonly db: Kysely<Database>) {}

  saveClient(params: { id: string; record: OAuthClientRecord }): Promise<void> {
    return saveClient(this.db, params);
  }

  getClient(params: { id: string }): Promise<OAuthClientRecord | undefined> {
    return getClient(this.db, params);
  }
}
