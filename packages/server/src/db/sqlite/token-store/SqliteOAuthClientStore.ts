import type { IOAuthClientStore, OAuthClientRecord } from '@truefoundry/utils/core';
import type { Kysely } from 'kysely';
import type { Database } from '../types';
import { deleteClient, getClient, saveClient } from './queries/oauthClient';

/**
 * Generic, SQLite-backed `IOAuthClientStore`. Persisted on `mcp_server.oauth_server` /
 * `.oauth_client` today — the one place this is MCP-specific by accident of where the columns
 * live, not by anything in the interface. Moving this to a dedicated table later only touches
 * this class and its queries, not `IOAuthClientStore` or any MCP orchestration code.
 */
export class SqliteOAuthClientStore implements IOAuthClientStore {
  constructor(private readonly db: Kysely<Database>) {}

  saveClient(params: { id: string; record: OAuthClientRecord }): Promise<void> {
    return saveClient(this.db, params);
  }

  getClient(params: { id: string }): Promise<OAuthClientRecord | undefined> {
    return getClient(this.db, params);
  }

  deleteClient(params: { id: string }): Promise<void> {
    return deleteClient(this.db, params);
  }
}
