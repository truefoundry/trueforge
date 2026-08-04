import type { IOAuthClientStore, OAuthClientRecord } from './IOAuthClientStore';

/**
 * In-memory OAuth-client facet of an MCP server store — for tests and any dev/no-DB usage.
 * Not for production use (no persistence across process restarts, no multi-replica sharing).
 */
/* eslint-disable @typescript-eslint/require-await -- in-memory store is synchronous; methods stay async for IOAuthClientStore callers */
export class InMemoryOAuthClientStore implements IOAuthClientStore {
  private readonly clients = new Map<string, OAuthClientRecord>();

  async saveClient(params: { id: string; record: OAuthClientRecord }): Promise<void> {
    this.clients.set(params.id, params.record);
  }

  async getClient(params: { id: string }): Promise<OAuthClientRecord | undefined> {
    return this.clients.get(params.id);
  }

  async deleteClient(params: { id: string }): Promise<void> {
    this.clients.delete(params.id);
  }
}
/* eslint-enable @typescript-eslint/require-await */
