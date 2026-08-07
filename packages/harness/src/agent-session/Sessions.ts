/**
 * Storage-only session collection: create / get. Behavior arrives per run via
 * the resolver on {@link SessionHandle.createTurn}.
 */
import { SessionHandle } from './SessionHandle';
import type { CreateSessionInput, GetSessionInput, ISessionStore } from './store/ISessionStore';

export type SessionsCreateInput<TSessionCustom extends object> = Omit<CreateSessionInput<TSessionCustom>, 'custom'> & {
  custom?: TSessionCustom | undefined;
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
}
