import type { IMcpTokenStore } from './IMcpTokenStore';
import type { McpOAuthClientRecord, McpOAuthPendingAuthorization, McpOAuthToken } from './types';

/* eslint-disable @typescript-eslint/require-await -- in-memory store is synchronous; methods stay async for IMcpTokenStore callers */
export class InMemoryMcpTokenStore implements IMcpTokenStore {
  private readonly clients = new Map<string, McpOAuthClientRecord>();
  private readonly tokens = new Map<string, McpOAuthToken>();
  private readonly pending = new Map<string, McpOAuthPendingAuthorization>();

  async saveOAuthClient(params: { serverId: string; record: McpOAuthClientRecord }): Promise<void> {
    this.clients.set(params.serverId, params.record);
  }

  async getOAuthClient(params: { serverId: string }): Promise<McpOAuthClientRecord | undefined> {
    return this.clients.get(params.serverId);
  }

  async savePendingAuthorization(pending: McpOAuthPendingAuthorization): Promise<void> {
    this.pending.set(pending.state, pending);
  }

  async getPendingAuthorization(params: { state: string }): Promise<McpOAuthPendingAuthorization | undefined> {
    return this.pending.get(params.state);
  }

  async saveToken(params: { serverId: string; token: McpOAuthToken }): Promise<void> {
    this.tokens.set(params.serverId, params.token);
  }

  async getToken(params: { serverId: string }): Promise<McpOAuthToken | undefined> {
    return this.tokens.get(params.serverId);
  }

  async deleteToken(params: { serverId: string }): Promise<void> {
    this.tokens.delete(params.serverId);
  }

  async delete(params: { serverId: string }): Promise<void> {
    this.clients.delete(params.serverId);
    this.tokens.delete(params.serverId);
    for (const [state, row] of this.pending) {
      if (row.serverId === params.serverId) {
        this.pending.delete(state);
      }
    }
  }
}
/* eslint-enable @typescript-eslint/require-await */
