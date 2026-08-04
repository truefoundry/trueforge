import type { IOAuthTokenStore, OAuthPendingAuthorization, OAuthToken } from './IOAuthTokenStore';

/** This implementation's read-expiry window; the SQL-backed stores pick their own. */
const PENDING_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

/**
 * In-memory `IOAuthTokenStore` — for tests and any dev/no-DB usage. Not for production use (no
 * persistence across process restarts, no multi-replica sharing).
 */
/* eslint-disable @typescript-eslint/require-await -- in-memory store is synchronous; methods stay async for IOAuthTokenStore callers */
export class InMemoryOAuthTokenStore implements IOAuthTokenStore {
  private readonly tokens = new Map<string, OAuthToken>();
  private readonly pending = new Map<string, { row: OAuthPendingAuthorization; createdAtMs: number }>();

  async savePendingAuthorization(pending: OAuthPendingAuthorization): Promise<void> {
    this.pending.set(pending.state, { row: pending, createdAtMs: Date.now() });
  }

  async consumePendingAuthorization(params: { state: string }): Promise<OAuthPendingAuthorization | undefined> {
    const entry = this.pending.get(params.state);
    if (entry === undefined || entry.createdAtMs <= Date.now() - PENDING_AUTHORIZATION_TTL_MS) {
      return undefined;
    }
    this.pending.delete(params.state);
    return entry.row;
  }

  async saveToken(params: { id: string; token: OAuthToken }): Promise<void> {
    this.tokens.set(params.id, params.token);
  }

  async getToken(params: { id: string }): Promise<OAuthToken | undefined> {
    return this.tokens.get(params.id);
  }

  async getTokens(params: { ids: string[] }): Promise<Map<string, OAuthToken>> {
    const out = new Map<string, OAuthToken>();
    for (const id of params.ids) {
      const token = this.tokens.get(id);
      if (token) {
        out.set(id, token);
      }
    }
    return out;
  }

  async deleteToken(params: { id: string }): Promise<void> {
    this.tokens.delete(params.id);
  }
}
/* eslint-enable @typescript-eslint/require-await */
