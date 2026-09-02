/**
 * Storage-only session collection: create / get. Behavior arrives per run via
 * the resolver on {@link SessionHandle.createTurn}.
 */
import { ulid } from 'ulid';
import { SessionHandle } from './SessionHandle';
import type {
  CreateSessionInput,
  GetSessionByExternalIdInput,
  GetSessionInput,
  ISessionStore,
} from './store/ISessionStore';
import { SessionExternalIdConflictError } from './store/SessionStoreErrors';

export type SessionsCreateInput<TSessionCustom extends object> = Omit<
  CreateSessionInput<TSessionCustom>,
  'custom' | 'metadata'
> & {
  custom?: TSessionCustom | undefined;
  metadata?: CreateSessionInput<TSessionCustom>['metadata'] | undefined;
};

export class Sessions<
  TSessionCustom extends object = Record<string, never>,
  TTurnCustom extends object = Record<string, never>,
> {
  private readonly store: ISessionStore<TSessionCustom, TTurnCustom>;

  constructor(deps: { sessionStore: ISessionStore<TSessionCustom, TTurnCustom> }) {
    this.store = deps.sessionStore;
  }

  /**
   * Creates and persists a new session with a reference or inline agent binding.
   */
  async create(input: SessionsCreateInput<TSessionCustom>): Promise<SessionHandle<TSessionCustom, TTurnCustom>> {
    await this.store.createSession({
      ...input,
      custom: input.custom ?? null,
      metadata: input.metadata ?? {},
    });
    const record = await this.store.getSession({
      tenant_id: input.tenant_id,
      session_id: input.session_id,
    });
    if (!record) {
      throw new Error(`Session create succeeded but getSession returned undefined: ${input.session_id}`);
    }
    return new SessionHandle({
      store: this.store,
      session: record,
    });
  }

  /**
   * Returns the session as stored (ref agents are not hydrated to a value), or
   * undefined if not found. Read-only: does not bump last_activity_timestamp_ms.
   */
  async get(input: GetSessionInput): Promise<SessionHandle<TSessionCustom, TTurnCustom> | undefined> {
    const record = await this.store.getSession(input);
    if (!record) {
      return undefined;
    }
    return new SessionHandle({
      store: this.store,
      session: record,
    });
  }

  /**
   * Returns the session bound to this tenant-scoped external id, or undefined.
   * Read-only: does not bump last_activity_timestamp_ms.
   */
  async getByExternalId(
    input: GetSessionByExternalIdInput,
  ): Promise<SessionHandle<TSessionCustom, TTurnCustom> | undefined> {
    const record = await this.store.getSessionByExternalId(input);
    if (!record) {
      return undefined;
    }
    return new SessionHandle({
      store: this.store,
      session: record,
    });
  }

  /**
   * Get-or-create the session bound to a tenant-scoped `external_id`.
   */
  async getOrCreateByExternalId(
    input: Omit<SessionsCreateInput<TSessionCustom>, 'session_id' | 'external_id'> & { external_id: string },
  ): Promise<{ session: SessionHandle<TSessionCustom, TTurnCustom>; created: boolean }> {
    const { tenant_id, external_id } = input;

    const existing = await this.getByExternalId({ tenant_id, external_id });
    if (existing !== undefined) {
      return { session: existing, created: false };
    }

    try {
      const session = await this.create({
        ...input,
        session_id: ulid().toLowerCase(),
        external_id,
      });
      return { session, created: true };
    } catch (error) {
      if (!(error instanceof SessionExternalIdConflictError)) {
        throw error;
      }
      const winner = await this.getByExternalId({ tenant_id, external_id });
      if (winner === undefined) {
        throw error;
      }
      return { session: winner, created: false };
    }
  }
}
