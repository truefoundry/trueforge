import type { IOAuthClientStore, OAuthClientRegistration } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import type { Database } from '../types';
import { getClient, saveClient } from './queries/oauthClient';

export class SqliteMCPOAuthClientStore implements IOAuthClientStore {
  constructor(private readonly db: Kysely<Database>) {}

  saveClient(params: { id: string; registration: OAuthClientRegistration }): Promise<void> {
    return saveClient(this.db, params);
  }

  getClient(params: { id: string }): Promise<OAuthClientRegistration | undefined> {
    return getClient(this.db, params);
  }
}
