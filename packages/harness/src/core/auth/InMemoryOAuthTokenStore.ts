import type { IOAuthTokenStore, OAuthPendingAuthorization, OAuthToken } from './IOAuthTokenStore';

/**
 * In-memory `IOAuthTokenStore` — for tests and any dev/no-DB usage. Not for production use (no
 * persistence across process restarts, no multi-replica sharing).
 */
export class InMemoryOAuthTokenStore implements IOAuthTokenStore {
  private readonly tokens = new Map<string, OAuthToken>();
  private readonly pending = new Map<string, OAuthPendingAuthorization>();

  async savePendingAuthorization(pending: OAuthPendingAuthorization): Promise<void> {
    this.pending.set(pending.state, pending);
  }

  async getPendingAuthorization(params: { state: string }): Promise<OAuthPendingAuthorization | undefined> {
    return this.pending.get(params.state);
  }
  async saveToken(params: { server_id: string; token: OAuthToken }): Promise<void> {
    this.tokens.set(params.server_id, params.token);
  }

  async getToken(params: { server_id: string }): Promise<OAuthToken | undefined> {
    return this.tokens.get(params.server_id);
  }

  async delete(params: { server_id: string }): Promise<void> {
    this.tokens.delete(params.server_id);
    for (const [state, entry] of this.pending) {
      if (entry.server_id === params.server_id) {
        this.pending.delete(state);
      }
    }
  }
}
