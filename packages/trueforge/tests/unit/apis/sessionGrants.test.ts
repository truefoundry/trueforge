import { OpenAPIHono, z } from '@hono/zod-openapi';
import { AgentSpecSchema, Sessions } from '@truefoundry/trueforge-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import type { Context } from 'hono';
import { sql, type Kysely } from 'kysely';
import { createClient } from 'redis';
import { createLogger } from 'winston';
import { createSessionsRouter } from '../../../src/apis/sessions';
import { createTurnsRouter } from '../../../src/apis/turns';
import { createAppErrorHandler } from '../../../src/app';
import { TrueForgeAuthorizer } from '../../../src/auth/authorizer';
import type { RequestContext } from '../../../src/auth/identity';
import { McpServerWithAuthStore } from '../../../src/db/McpServerWithAuthStore';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAccessControlStore } from '../../../src/db/sqlite/access-control-store/SqliteAccessControlStore';
import { SqliteAgentStore } from '../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxEnvironmentStore } from '../../../src/db/sqlite/sandbox-environment-store/SqliteSandboxEnvironmentStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSessionStore } from '../../../src/db/sqlite/session-store/SqliteSessionStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import type { Database } from '../../../src/db/sqlite/types';
import { SqliteWebSearchProviderStore } from '../../../src/db/sqlite/web-search-provider-store/SqliteWebSearchProviderStore';
import { EmptyUserStore, type IUserStore } from '../../../src/db/userStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription';
import { ListSessionGrantsResponseSchema } from '../../../src/schemas/sessionGrant';
import type { User } from '../../../src/schemas/user';

const TENANT = 'default';
const SESSION_ID = 'shared-session';
const CALLER_HEADER = 'x-test-caller';
/** Callers named `sa:<id>` are service accounts rather than users. */
const SERVICE_ACCOUNT_PREFIX = 'sa:';

const SharedSessionBodySchema = z.object({ data: z.object({ shared: z.boolean() }) });
const SharedSessionListSchema = z.object({ data: z.array(z.object({ shared: z.boolean() })) });

const USERS: User[] = [
  { id: 'alice', display_name: 'Alice', email: 'alice@example.com' },
  { id: 'bob', display_name: 'Bob', email: 'bob@example.com' },
];

function contextFor(caller: string): RequestContext {
  const isServiceAccount = caller.startsWith(SERVICE_ACCOUNT_PREFIX);
  const id = isServiceAccount ? caller.slice(SERVICE_ACCOUNT_PREFIX.length) : caller;
  return {
    tenant_id: TENANT,
    subject: { id, type: isServiceAccount ? 'serviceaccount' : 'user', display_name: id },
    roles: [],
    user_credential: null,
  };
}

/** Stands in for the TrueFoundry user source: ids are the ones grantees authenticate with. */
class FakeUserStore implements IUserStore {
  readonly supportsUserLookup = true;
  readonly getUsersByIdsCalls: string[][] = [];
  readonly #users: User[];

  constructor(users: User[]) {
    this.#users = users;
  }

  listUsers(): Promise<{ data: User[]; total: number }> {
    return Promise.resolve({ data: this.#users, total: this.#users.length });
  }

  getUsersByIds(input: { ids: readonly string[] }): Promise<User[]> {
    this.getUsersByIdsCalls.push([...input.ids]);
    const ids = new Set(input.ids);
    return Promise.resolve(this.#users.filter(user => ids.has(user.id)));
  }
}

function jsonInit(method: string, body: unknown, caller = 'owner'): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json', [CALLER_HEADER]: caller },
    body: JSON.stringify(body),
  };
}

function asCaller(caller: string, method = 'GET'): RequestInit {
  return { method, headers: { [CALLER_HEADER]: caller } };
}

function buildApp(input: { db: Kysely<Database>; sessionStore: SqliteSessionStore; userStore: IUserStore }) {
  const { db, sessionStore, userStore } = input;
  const agentStore = new SqliteAgentStore(db);
  const accessControlStore = new SqliteAccessControlStore(db);
  const sessions = new Sessions({ sessionStore });
  const resolveRequestContext = (c: Context) => contextFor(c.req.header(CALLER_HEADER) ?? 'owner');
  const logger = createLogger({ silent: true });
  const app = new OpenAPIHono();
  app.route(
    '/',
    createTurnsRouter({
      sessions,
      sessionStore,
      accessControlStore,
      activeTurns: new ActiveTurnRegistry(),
      resolveModelProviderStore: () => new SqliteModelProviderStore(db),
      resolveMcpServerStore: () =>
        new McpServerWithAuthStore({
          store: new SqliteMcpServerStore(db),
          tokenStore: new SqliteOAuthTokenStore(db),
          clientName: 'test-client',
        }),
      resolveTurnSkillsStore: () => new SqliteSkillStore(db),
      resolveCapabilitiesStore: () => ({ resolveCapabilities: () => [] }),
      resolveAgentStore: () => agentStore,
      eventSubscriptions: new EventSubscriptionRegistry(undefined),
      resolveSandboxProviderStore: () => new SqliteSandboxProviderStore(db),
      sandboxEnvironmentStore: new SqliteSandboxEnvironmentStore(db),
      resolveWebSearchProviderStore: () => new SqliteWebSearchProviderStore(db),
      logger,
      resolveRequestContext,
      authorizer: new TrueForgeAuthorizer(),
    }),
  );
  app.route(
    '/',
    createSessionsRouter({
      sessions,
      sessionStore,
      accessControlStore,
      userStore,
      withTransaction: callback => db.transaction().execute(callback),
      activeTurns: new ActiveTurnRegistry(),
      resolveModelProviderStore: () => new SqliteModelProviderStore(db),
      resolveMcpServerStore: () => new SqliteMcpServerStore(db),
      resolveSkillStore: () => new SqliteSkillStore(db),
      resolveAgentStore: () => agentStore,
      resolveSandboxProviderStore: () => new SqliteSandboxProviderStore(db),
      sandboxEnvironmentStore: new SqliteSandboxEnvironmentStore(db),
      resolveWebSearchProviderStore: () => new SqliteWebSearchProviderStore(db),
      redis: createClient(),
      requestReplyRouter: new RequestReplyRouter(),
      resolveRequestContext,
      logger,
      authorizer: new TrueForgeAuthorizer(),
    }),
  );
  app.onError(createAppErrorHandler({ logger }));
  return app;
}

describe('session grants API', () => {
  let db: Kysely<Database>;
  let sessionStore: SqliteSessionStore;
  let fakeUserStore: FakeUserStore;
  let app: OpenAPIHono;

  beforeEach(async () => {
    db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    sessionStore = new SqliteSessionStore(db);
    fakeUserStore = new FakeUserStore(USERS);
    app = buildApp({ db, sessionStore, userStore: fakeUserStore });
    await sessionStore.createSession({
      tenant_id: TENANT,
      session_id: SESSION_ID,
      created_by_subject: { subject_id: 'owner', subject_type: 'user', subject_display_name: 'Owner' },
      agent: {
        type: 'inline',
        spec: AgentSpecSchema.parse({ model: { name: 'test-provider/test-model' }, instructions: 'test' }),
      },
      custom: null,
      metadata: {},
      external_id: null,
      source: null,
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  async function listSubjectIds(): Promise<string[]> {
    const response = await app.request(`/${SESSION_ID}/grants`, asCaller('owner'));
    expect(response.status).toBe(200);
    return ListSessionGrantsResponseSchema.parse(await response.json()).data.map(grant => grant.subject.subject_id);
  }

  function users(subjectIds: string[]) {
    return subjectIds.map(subject_id => ({ subject_type: 'user', subject_id }));
  }

  async function update(body: unknown, caller = 'owner'): Promise<Response> {
    return app.request(`/${SESSION_ID}/grants`, jsonInit('POST', body, caller));
  }

  async function grantedIds(response: Response): Promise<string[]> {
    return ListSessionGrantsResponseSchema.parse(await response.json()).data.map(grant => grant.subject.subject_id);
  }

  describe('access rules', () => {
    it('rejects callers other than the session creator', async () => {
      const forbidden = { error: { message: 'Only the session creator can manage access to this session' } };

      const list = await app.request(`/${SESSION_ID}/grants`, asCaller('alice'));
      expect(list.status).toBe(403);
      expect(await list.json()).toEqual(forbidden);

      expect((await update({ grant: users(['bob']) }, 'alice')).status).toBe(403);
      expect((await update({ revoke: users(['bob']) }, 'alice')).status).toBe(403);
    });

    it('returns 404 for an unknown session', async () => {
      expect((await app.request('/missing/grants', asCaller('owner'))).status).toBe(404);
      expect((await app.request('/missing/grants', jsonInit('POST', { grant: users(['alice']) }))).status).toBe(404);
    });
  });

  describe('grant', () => {
    it('shares with users and returns every subject with access', async () => {
      const response = await update({ grant: users(['alice', 'bob']) });

      expect(response.status).toBe(200);
      const { data } = ListSessionGrantsResponseSchema.parse(await response.json());
      const grantedBy = { subject_id: 'owner', subject_type: 'user', subject_display_name: 'owner' };
      expect(data).toEqual([
        {
          subject: { subject_type: 'user', subject_id: 'alice' },
          granted_by_subject: grantedBy,
          created_at: expect.any(String),
        },
        {
          subject: { subject_type: 'user', subject_id: 'bob' },
          granted_by_subject: grantedBy,
          created_at: expect.any(String),
        },
      ]);
    });

    it('collapses duplicates and is idempotent', async () => {
      expect((await update({ grant: users(['alice', 'alice']) })).status).toBe(200);
      expect(fakeUserStore.getUsersByIdsCalls[0]).toEqual(['alice']);

      const again = await update({ grant: users(['alice']) });
      expect(again.status).toBe(200);
      expect(await grantedIds(again)).toEqual(['alice']);
    });

    it('rejects sharing with the session creator', async () => {
      const response = await update({ grant: users(['owner']) });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'The session creator already has access.' } });
    });

    it('rejects unknown users without writing anything', async () => {
      const response = await update({ grant: users(['alice', 'ghost', 'phantom']) });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'Unknown users: ghost, phantom' } });
      expect(await listSubjectIds()).toEqual([]);
    });

    it('rejects every user when no user store is configured', async () => {
      app = buildApp({ db, sessionStore, userStore: new EmptyUserStore() });

      const response = await update({ grant: users(['alice']) });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'Unknown users: alice' } });
    });
  });

  describe('revoke', () => {
    it('removes several subjects in one call and ignores ones without access', async () => {
      expect((await update({ grant: users(['alice', 'bob']) })).status).toBe(200);

      const response = await update({ revoke: users(['alice', 'alice', 'nobody']) });

      expect(response.status).toBe(200);
      expect(await grantedIds(response)).toEqual(['bob']);
    });

    it('does not look up users that are only being revoked', async () => {
      app = buildApp({ db, sessionStore, userStore: new EmptyUserStore() });

      const response = await update({ revoke: users(['alice']) });

      expect(response.status).toBe(200);
      expect(await grantedIds(response)).toEqual([]);
    });
  });

  describe('grant and revoke together', () => {
    it('applies both lists in one request', async () => {
      expect((await update({ grant: users(['alice']) })).status).toBe(200);

      const response = await update({ grant: users(['bob']), revoke: users(['alice']) });

      expect(response.status).toBe(200);
      expect(await grantedIds(response)).toEqual(['bob']);
    });

    it('writes nothing when a subject to grant is invalid', async () => {
      expect((await update({ grant: users(['alice']) })).status).toBe(200);

      const response = await update({ grant: users(['ghost']), revoke: users(['alice']) });

      expect(response.status).toBe(422);
      expect(await listSubjectIds()).toEqual(['alice']);
    });

    it('rejects a subject that is both granted and revoked', async () => {
      const response = await update({ grant: users(['alice']), revoke: users(['alice']) });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'A subject cannot be both granted and revoked.' } });
      expect(await listSubjectIds()).toEqual([]);
    });

    it('accepts up to 50 subjects in each list', async () => {
      fakeUserStore = new FakeUserStore(
        Array.from({ length: 50 }, (_, i) => ({
          id: `u${String(i)}`,
          display_name: `U${String(i)}`,
          email: `u${String(i)}@x`,
        })),
      );
      app = buildApp({ db, sessionStore, userStore: fakeUserStore });
      const fifty = Array.from({ length: 50 }, (_, i) => `u${String(i)}`);
      const fiftyOthers = Array.from({ length: 50 }, (_, i) => `v${String(i)}`);

      const response = await update({ grant: users(fifty), revoke: users(fiftyOthers) });

      expect(response.status).toBe(200);
      expect(await grantedIds(response)).toHaveLength(50);
    });
  });

  it.each([
    ['an empty body', {}],
    ['two empty lists', { grant: [], revoke: [] }],
    ['more than 50 subjects to grant', { grant: users(Array.from({ length: 51 }, (_, i) => `u${String(i)}`)) }],
    ['more than 50 subjects to revoke', { revoke: users(Array.from({ length: 51 }, (_, i) => `u${String(i)}`)) }],
    ['an unsupported subject type', { grant: [{ subject_type: 'team', subject_id: 'default' }] }],
    ['an unknown field', { subjects: users(['alice']) }],
  ])('rejects %s', async (_label, body) => {
    expect((await update(body)).status).toBe(400);
  });

  describe('list', () => {
    it('lists subjects without looking up users', async () => {
      expect((await update({ grant: users(['alice']) })).status).toBe(200);
      const callsAfterShare = fakeUserStore.getUsersByIdsCalls.length;

      const response = await app.request(`/${SESSION_ID}/grants`, asCaller('owner'));

      expect(response.status).toBe(200);
      expect(ListSessionGrantsResponseSchema.parse(await response.json()).data).toEqual([
        expect.objectContaining({ subject: { subject_type: 'user', subject_id: 'alice' } }),
      ]);
      expect(fakeUserStore.getUsersByIdsCalls).toHaveLength(callsAfterShare);
    });
  });

  /** Statuses for get session, list events, list turns, get turn, list turn events. */
  async function readStatuses(caller: string): Promise<number[]> {
    const paths = [
      `/${SESSION_ID}`,
      `/${SESSION_ID}/events`,
      `/${SESSION_ID}/turns`,
      `/${SESSION_ID}/turns/missing`,
      `/${SESSION_ID}/turns/missing/events`,
    ];
    const statuses: number[] = [];
    for (const path of paths) {
      statuses.push((await app.request(path, asCaller(caller))).status);
    }
    return statuses;
  }

  const CAN_READ = [200, 200, 200, 404, 404];
  const CANNOT_READ = [403, 403, 403, 403, 403];

  /** `shared` as the owner sees it from get session and from list sessions. */
  async function sharedFlag(): Promise<{ get: boolean; list: boolean[] }> {
    const got = SharedSessionBodySchema.parse(await (await app.request(`/${SESSION_ID}`, asCaller('owner'))).json());
    const listed = SharedSessionListSchema.parse(await (await app.request('/', asCaller('owner'))).json());
    return { get: got.data.shared, list: listed.data.map(session => session.shared) };
  }

  describe('read access', () => {
    it('a user grant gives read access and nothing more, until revoked', async () => {
      expect((await update({ grant: users(['alice']) })).status).toBe(200);

      expect(await readStatuses('alice')).toEqual(CAN_READ);
      expect(await readStatuses('bob')).toEqual(CANNOT_READ);

      const download = `/${SESSION_ID}/turns/missing/download-sandbox-file?path=${encodeURIComponent('/workspace/f')}`;
      expect((await app.request(`/${SESSION_ID}`, jsonInit('PATCH', { title: 'x' }, 'alice'))).status).toBe(403);
      expect((await app.request(`/${SESSION_ID}`, asCaller('alice', 'DELETE'))).status).toBe(403);
      expect((await app.request(`/${SESSION_ID}/cancel`, asCaller('alice', 'POST'))).status).toBe(403);
      expect((await app.request(`/${SESSION_ID}/turns`, jsonInit('POST', { stream: false }, 'alice'))).status).toBe(
        403,
      );
      expect((await app.request(`/${SESSION_ID}/turns/missing/subscribe`, asCaller('alice'))).status).toBe(403);
      expect((await app.request(download, asCaller('alice'))).status).toBe(403);
      expect((await app.request(`/${SESSION_ID}/grants`, asCaller('alice'))).status).toBe(403);

      expect((await update({ revoke: users(['alice']) })).status).toBe(200);
      expect(await readStatuses('alice')).toEqual(CANNOT_READ);
    });

    it('a non-user subject with the same id cannot use a user grant', async () => {
      expect((await update({ grant: users(['alice']) })).status).toBe(200);

      expect(await readStatuses(`${SERVICE_ACCOUNT_PREFIX}alice`)).toEqual(CANNOT_READ);
    });
  });

  describe('sharing with the tenant', () => {
    const everyone = [{ subject_type: 'tenant', subject_id: TENANT }];

    it('works without a user source and lets any subject in the tenant read', async () => {
      app = buildApp({ db, sessionStore, userStore: new EmptyUserStore() });
      expect(await sharedFlag()).toEqual({ get: false, list: [false] });

      const response = await update({ grant: everyone });

      expect(response.status).toBe(200);
      expect(ListSessionGrantsResponseSchema.parse(await response.json()).data).toEqual([
        expect.objectContaining({ subject: { subject_type: 'tenant', subject_id: TENANT } }),
      ]);
      expect(await readStatuses('alice')).toEqual(CAN_READ);
      expect(await readStatuses(`${SERVICE_ACCOUNT_PREFIX}bot`)).toEqual(CAN_READ);
      expect(await sharedFlag()).toEqual({ get: true, list: [true] });
    });

    it('rejects a tenant other than the caller’s', async () => {
      const response = await update({ grant: [{ subject_type: 'tenant', subject_id: 'other-tenant' }] });

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'A tenant subject must be your own tenant.' } });
    });

    it('revoking the tenant removes access', async () => {
      expect((await update({ grant: everyone })).status).toBe(200);

      expect((await update({ revoke: everyone })).status).toBe(200);

      expect(await readStatuses('alice')).toEqual(CANNOT_READ);
      expect(await sharedFlag()).toEqual({ get: false, list: [false] });
    });

    it('ignores the legacy session.shared column', async () => {
      await sql`UPDATE session SET shared = 1 WHERE session_id = ${SESSION_ID}`.execute(db);

      expect(await readStatuses('alice')).toEqual(CANNOT_READ);
      expect(await sharedFlag()).toEqual({ get: false, list: [false] });
    });

    it('the deprecated PATCH { shared } grants and revokes the tenant', async () => {
      app = buildApp({ db, sessionStore, userStore: new EmptyUserStore() });

      const shared = await app.request(`/${SESSION_ID}`, jsonInit('PATCH', { shared: true }));

      expect(shared.status).toBe(200);
      expect(SharedSessionBodySchema.parse(await shared.json()).data.shared).toBe(true);
      expect(await listSubjectIds()).toEqual([TENANT]);
      expect(await readStatuses('alice')).toEqual(CAN_READ);

      const unshared = await app.request(`/${SESSION_ID}`, jsonInit('PATCH', { shared: false }));

      expect(unshared.status).toBe(200);
      expect(SharedSessionBodySchema.parse(await unshared.json()).data.shared).toBe(false);
      expect(await listSubjectIds()).toEqual([]);
      expect(await readStatuses('alice')).toEqual(CANNOT_READ);
    });

    it('the deprecated PATCH { shared } stays creator-only', async () => {
      expect((await app.request(`/${SESSION_ID}`, jsonInit('PATCH', { shared: true }, 'alice'))).status).toBe(403);
      expect(await listSubjectIds()).toEqual([]);
    });
  });
});
