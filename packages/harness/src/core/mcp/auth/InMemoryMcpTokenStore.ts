import { InMemoryOAuthTokenStore } from '../../auth/InMemoryOAuthTokenStore';
import type { IOAuthTokenStore } from '../../auth/IOAuthTokenStore';
import type { IMcpTokenStore } from './IMcpTokenStore';
import type { McpOAuthClientRecord, McpOAuthPendingAuthorization, McpOAuthToken } from './types';

/**
 * In-memory `IMcpTokenStore` — for tests and any dev/no-DB usage. Not for production use (no
 * persistence across process restarts, no multi-replica sharing).
 *
 * Composes a generic `IOAuthTokenStore` (`core/auth`) for the pending-authorization/token state
 * and only owns OAuth client/server registration (`McpOAuthClientRecord`) itself — the one part
 * that's genuinely MCP-specific today (it lives on `mcp_server`, not a generic OAuth table). This
 * mirrors the intended DB-backed shape: an `IMcpTokenStore` implementation composes a
 * DB-independent `IOAuthTokenStore` rather than reimplementing token/pending storage itself.
 */
/* eslint-disable @typescript-eslint/require-await -- in-memory store is synchronous; methods stay async for IMcpTokenStore callers */
export class InMemoryMcpTokenStore implements IMcpTokenStore {
  private readonly clients = new Map<string, McpOAuthClientRecord>();

  constructor(private readonly tokenStore: IOAuthTokenStore = new InMemoryOAuthTokenStore()) {}

  async saveOAuthClient(params: { serverId: string; record: McpOAuthClientRecord }): Promise<void> {
    this.clients.set(params.serverId, params.record);
  }

  async getOAuthClient(params: { serverId: string }): Promise<McpOAuthClientRecord | undefined> {
    return this.clients.get(params.serverId);
  }

  savePendingAuthorization(pending: McpOAuthPendingAuthorization): Promise<void> {
    return this.tokenStore.savePendingAuthorization({
      state: pending.state,
      id: pending.serverId,
      codeVerifier: pending.codeVerifier,
      redirectUrl: pending.redirectUrl,
    });
  }

  async getPendingAuthorization(params: { state: string }): Promise<McpOAuthPendingAuthorization | undefined> {
    const row = await this.tokenStore.getPendingAuthorization(params);
    if (!row) {
      return undefined;
    }
    return { state: row.state, serverId: row.id, codeVerifier: row.codeVerifier, redirectUrl: row.redirectUrl };
  }

  saveToken(params: { serverId: string; token: McpOAuthToken }): Promise<void> {
    return this.tokenStore.saveToken({ id: params.serverId, token: params.token });
  }

  getToken(params: { serverId: string }): Promise<McpOAuthToken | undefined> {
    return this.tokenStore.getToken({ id: params.serverId });
  }

  deleteToken(params: { serverId: string }): Promise<void> {
    return this.tokenStore.deleteToken({ id: params.serverId });
  }

  async delete(params: { serverId: string }): Promise<void> {
    this.clients.delete(params.serverId);
    await this.tokenStore.delete({ id: params.serverId });
  }
}
/* eslint-enable @typescript-eslint/require-await */
