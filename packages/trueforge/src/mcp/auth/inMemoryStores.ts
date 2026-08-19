import type {
  IOAuthClientStore,
  IOAuthTokenStore,
  OAuthClientRecord,
  OAuthPendingAuthorization,
  OAuthToken,
  OAuthTokenKey,
} from './types';

const PENDING_AUTHORIZATION_TTL_MS = 10 * 60 * 1000;

function tokenMapKey(params: OAuthTokenKey): string {
  return `${params.id}\0${params.userRef}`;
}

/** In-memory OAuth token store for tests and development without a database. */
/* eslint-disable @typescript-eslint/require-await -- synchronous implementation of an async store contract */
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

  async saveToken(params: OAuthTokenKey & { token: OAuthToken }): Promise<void> {
    this.tokens.set(tokenMapKey(params), params.token);
  }

  async getToken(params: OAuthTokenKey): Promise<OAuthToken | undefined> {
    return this.tokens.get(tokenMapKey(params));
  }

  async getTokens(params: { ids: string[]; userRef: string }): Promise<Map<string, OAuthToken>> {
    const tokens = new Map<string, OAuthToken>();
    for (const id of params.ids) {
      const token = this.tokens.get(tokenMapKey({ id, userRef: params.userRef }));
      if (token !== undefined) {
        tokens.set(id, token);
      }
    }
    return tokens;
  }

  async deleteToken(params: OAuthTokenKey): Promise<void> {
    this.tokens.delete(tokenMapKey(params));
  }

  async deleteTokensForServer(params: { id: string }): Promise<void> {
    const prefix = `${params.id}\0`;
    for (const key of this.tokens.keys()) {
      if (key.startsWith(prefix)) {
        this.tokens.delete(key);
      }
    }
  }

  async deletePendingAuthorizationsForServer(params: { id: string }): Promise<void> {
    for (const [state, entry] of this.pending) {
      if (entry.row.id === params.id) {
        this.pending.delete(state);
      }
    }
  }
}

/** In-memory OAuth client store for tests and development without a database. */
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
