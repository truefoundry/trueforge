import type { IOAuthTokenStore, OAuthPendingAuthorization, OAuthToken } from './IOAuthTokenStore';

/**
 * In-memory `IOAuthTokenStore` — for tests and any dev/no-DB usage. Not for production use (no
 * persistence across process restarts, no multi-replica sharing).
 */
/* eslint-disable @typescript-eslint/require-await -- in-memory store is synchronous; methods stay async for IOAuthTokenStore callers */
export class InMemoryOAuthTokenStore implements IOAuthTokenStore {
  private readonly tokens = new Map<string, OAuthToken>();
  private readonly pending = new Map<string, OAuthPendingAuthorization>();

  async savePendingAuthorization(pending: OAuthPendingAuthorization): Promise<void> {
    this.pending.set(pending.state, pending);
  }

  async getPendingAuthorization(params: { state: string }): Promise<OAuthPendingAuthorization | undefined> {
    return this.pending.get(params.state);
  }

  async saveToken(params: { id: string; token: OAuthToken }): Promise<void> {
    this.tokens.set(params.id, params.token);
  }

  async getToken(params: { id: string }): Promise<OAuthToken | undefined> {
    return this.tokens.get(params.id);
  }

  async deleteToken(params: { id: string }): Promise<void> {
    this.tokens.delete(params.id);
  }

  async delete(params: { id: string }): Promise<void> {
    this.tokens.delete(params.id);
    for (const [state, row] of this.pending) {
      if (row.id === params.id) {
        this.pending.delete(state);
      }
    }
  }
}
/* eslint-enable @typescript-eslint/require-await */
