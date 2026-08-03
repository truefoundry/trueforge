import type { IOAuthClientStore, OAuthClientRegistration } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import type { Database } from '../types';
import { deleteClient, getClient, saveClient } from './queries/oauthClient';

/**
 * Generic, Postgres-backed `IOAuthClientStore`. Persisted on `mcp_server.oauth_server` /
 * `.oauth_client` today — the one place this is MCP-specific by accident of where the columns
 * live, not by anything in the interface. Moving this to a dedicated table later only touches
 * this class and its queries, not `IOAuthClientStore` or any MCP orchestration code.
 */
export class PostgresOAuthClientStore implements IOAuthClientStore {
  constructor(private readonly db: Kysely<Database>) {}

  saveClient(params: { id: string; registration: OAuthClientRegistration }): Promise<void> {
    return saveClient(this.db, params);
  }

  getClient(params: { id: string }): Promise<OAuthClientRegistration | undefined> {
    return getClient(this.db, params);
  }

  deleteClient(params: { id: string }): Promise<void> {
    return deleteClient(this.db, params);
  }
}
