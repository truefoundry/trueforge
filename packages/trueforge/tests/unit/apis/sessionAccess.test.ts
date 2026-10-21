import { OpenAPIHono } from '@hono/zod-openapi';
import { AgentSpecSchema, Sessions } from '@truefoundry/trueforge-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import type { Context } from 'hono';
import type { Kysely } from 'kysely';
import { createClient } from 'redis';
import { createLogger } from 'winston';
import { makeCreateTurnInput } from '../../../../trueforge-core/tests/agent-session/testHelpers';
import { createSessionsRouter } from '../../../src/apis/sessions';
import { createTurnsRouter } from '../../../src/apis/turns';
import { createAppErrorHandler } from '../../../src/app';
import { TrueForgeAuthorizer } from '../../../src/auth/authorizer';
import type { RequestContext } from '../../../src/auth/identity';
import { EmptyUserDirectory, type UserDirectory } from '../../../src/auth/userDirectory';
import { McpServerWithAuthStore } from '../../../src/db/McpServerWithAuthStore';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAccessControlEntryStore } from '../../../src/db/sqlite/access-control-entry-store/SqliteAccessControlEntryStore';
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
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { EventSubscriptionRegistry } from '../../../src/runtime/event-subscription/index.js';
import { GetSessionResponseSchema, ListSessionsResponseSchema } from '../../../src/schemas/session';
import { ListSessionAccessResponseSchema } from '../../../src/schemas/sessionAccess';
import type { DirectoryUser } from '../../../src/schemas/user';

const TENANT = 'default';
const SESSION_ID = 'shared-session';
const TURN_ID = 'turn-1';
const CALLER_HEADER = 'x-test-caller';

const USERS: DirectoryUser[] = [
  { id: 'alice', display_name: 'Alice', email: 'alice@example.com' },
  { id: 'bob', display_name: 'Bob', email: null },
];

function contextFor(subjectId: string): RequestContext {
  return {
    tenant_id: TENANT,
    subject: { id: subjectId, type: 'user', display_name: subjectId },
    roles: [],
    user_credential: null,
  };
}

class FakeUserDirectory implements UserDirectory {
  readonly getUsersByIdsCalls: string[][] = [];
  readonly #users: DirectoryUser[];

  constructor(users: DirectoryUser[]) {
    this.#users = users;
  }

  listUsers(): Promise<{ data: DirectoryUser[]; total: number }> {
    return Promise.resolve({ data: this.#users, total: this.#users.length });
  }

  getUsersByIds(input: { ids: readonly string[] }): Promise<DirectoryUser[]> {
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

function buildApp(input: { db: Kysely<Database>; sessionStore: SqliteSessionStore; userDirectory: UserDirectory }) {
  const { db, sessionStore, userDirectory } = input;
  const sessions = new Sessions({ sessionStore });
  const accessControlEntryStore = new SqliteAccessControlEntryStore(db);
  const activeTurns = new ActiveTurnRegistry();
  const agentStore = new SqliteAgentStore(db);
  const modelProviderStore = new SqliteModelProviderStore(db);
  const mcpServerStore = new McpServerWithAuthStore({
    store: new SqliteMcpServerStore(db),
    tokenStore: new SqliteOAuthTokenStore(db),
    clientName: 'test-client',
  });
  const skillStore = new SqliteSkillStore(db);
  const sandboxProviderStore = new SqliteSandboxProviderStore(db);
  const sandboxEnvironmentStore = new SqliteSandboxEnvironmentStore(db);
  const webSearchProviderStore = new SqliteWebSearchProviderStore(db);
  const resolveRequestContext = (c: Context) => contextFor(c.req.header(CALLER_HEADER) ?? 'owner');
  const authorizer = new TrueForgeAuthorizer();
  const logger = createLogger({ silent: true });
  const app = new OpenAPIHono();
  app.route(
    '/',
    createSessionsRouter({
      sessions,
      sessionStore,
      accessControlEntryStore,
      userDirectory,
      activeTurns,
      resolveModelProviderStore: () => modelProviderStore,
      resolveMcpServerStore: () => mcpServerStore,
      resolveSkillStore: () => skillStore,
      resolveAgentStore: () => agentStore,
      resolveSandboxProviderStore: () => sandboxProviderStore,
      sandboxEnvironmentStore,
      resolveWebSearchProviderStore: () => webSearchProviderStore,
      redis: createClient(),
      requestReplyRouter: new RequestReplyRouter(),
      resolveRequestContext,
      logger,
      authorizer,
    }),
  );
  app.route(
    '/',
    createTurnsRouter({
      sessions,
      sessionStore,
      accessControlEntryStore,
      activeTurns,
      resolveModelProviderStore: () => modelProviderStore,
      resolveMcpServerStore: () => mcpServerStore,
      resolveTurnSkillsStore: () => skillStore,
      resolveAgentStore: () => agentStore,
      eventSubscriptions: new EventSubscriptionRegistry(undefined),
      resolveSandboxProviderStore: () => sandboxProviderStore,
      sandboxEnvironmentStore,
      resolveWebSearchProviderStore: () => webSearchProviderStore,
      logger,
      resolveRequestContext,
      authorizer,
    }),
  );
  app.onError(createAppErrorHandler({ logger }));
  return app;
}

describe('session access API', () => {
  let db: Kysely<Database>;
  let sessionStore: SqliteSessionStore;
  let directory: FakeUserDirectory;
  let app: OpenAPIHono;

  beforeEach(async () => {
    db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    sessionStore = new SqliteSessionStore(db);
    directory = new FakeUserDirectory(USERS);
    app = buildApp({ db, sessionStore, userDirectory: directory });
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

  async function listGrants(): Promise<string[]> {
    const response = await app.request(`/${SESSION_ID}/access`, asCaller('owner'));
    expect(response.status).toBe(200);
    return ListSessionAccessResponseSchema.parse(await response.json()).data.map(grant => grant.subject_id);
  }

  async function grant(subjectIds: string[]): Promise<Response> {
    return app.request(
      `/${SESSION_ID}/access`,
      jsonInit('POST', { subjects: subjectIds.map(subject_id => ({ subject_type: 'user', subject_id })) }),
    );
  }

  describe('access rules', () => {
    it('rejects callers other than the session creator', async () => {
      const forbidden = { error: { message: 'Only the session creator can manage access to this session' } };

      const list = await app.request(`/${SESSION_ID}/access`, asCaller('alice'));
      expect(list.status).toBe(403);
      expect(await list.json()).toEqual(forbidden);

      const create = await app.request(
        `/${SESSION_ID}/access`,
        jsonInit('POST', { subjects: [{ subject_type: 'user', subject_id: 'bob' }] }, 'alice'),
      );
      expect(create.status).toBe(403);

      const remove = await app.request(`/${SESSION_ID}/access/user/bob`, asCaller('alice', 'DELETE'));
      expect(remove.status).toBe(403);
    });

    it('returns 404 for an unknown session', async () => {
      expect((await app.request('/missing/access', asCaller('owner'))).status).toBe(404);
      expect(
        (
          await app.request(
            '/missing/access',
            jsonInit('POST', { subjects: [{ subject_type: 'user', subject_id: 'alice' }] }),
          )
        ).status,
      ).toBe(404);
      expect((await app.request('/missing/access/user/alice', asCaller('owner', 'DELETE'))).status).toBe(404);
    });
  });

  describe('create', () => {
    it('grants users and returns the enriched list', async () => {
      const response = await grant(['alice', 'bob']);

      expect(response.status).toBe(201);
      const { data } = ListSessionAccessResponseSchema.parse(await response.json());
      expect(data).toEqual([
        expect.objectContaining({
          subject_type: 'user',
          subject_id: 'alice',
          subject_display_name: 'Alice',
          subject_email: 'alice@example.com',
          granted_by_subject: { subject_id: 'owner', subject_type: 'user', subject_display_name: 'owner' },
        }),
        expect.objectContaining({ subject_id: 'bob', subject_display_name: 'Bob', subject_email: null }),
      ]);
    });

    it('collapses duplicates and is idempotent', async () => {
      expect((await grant(['alice', 'alice'])).status).toBe(201);
      expect(directory.getUsersByIdsCalls[0]).toEqual(['alice']);

      const again = await grant(['alice']);
      expect(again.status).toBe(201);
      expect(ListSessionAccessResponseSchema.parse(await again.json()).data.map(g => g.subject_id)).toEqual(['alice']);
    });

    it('rejects granting the session creator', async () => {
      const response = await grant(['owner']);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'The session creator already has access.' } });
    });

    it('rejects unknown users without writing anything', async () => {
      const response = await grant(['alice', 'ghost', 'phantom']);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'Unknown users: ghost, phantom' } });
      expect(await listGrants()).toEqual([]);
    });

    it('rejects every user when no directory is configured', async () => {
      app = buildApp({ db, sessionStore, userDirectory: new EmptyUserDirectory() });

      const response = await grant(['alice']);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'Unknown users: alice' } });
    });

    it.each([
      ['an empty subject list', { subjects: [] }],
      [
        'more than 100 subjects',
        {
          subjects: Array.from({ length: 101 }, (_, i) => ({ subject_type: 'user', subject_id: `u${String(i)}` })),
        },
      ],
      ['an unsupported subject type', { subjects: [{ subject_type: 'team', subject_id: 'platform' }] }],
    ])('rejects %s', async (_label, body) => {
      const response = await app.request(`/${SESSION_ID}/access`, jsonInit('POST', body));
      expect(response.status).toBe(400);
    });
  });

  describe('list', () => {
    it('keeps grants for users the directory no longer resolves', async () => {
      expect((await grant(['alice'])).status).toBe(201);
      app = buildApp({ db, sessionStore, userDirectory: new EmptyUserDirectory() });

      const response = await app.request(`/${SESSION_ID}/access`, asCaller('owner'));

      expect(response.status).toBe(200);
      expect(ListSessionAccessResponseSchema.parse(await response.json()).data).toEqual([
        expect.objectContaining({ subject_id: 'alice', subject_display_name: null, subject_email: null }),
      ]);
    });
  });

  describe('delete', () => {
    it('revokes an existing grant', async () => {
      expect((await grant(['alice', 'bob'])).status).toBe(201);

      const response = await app.request(`/${SESSION_ID}/access/user/alice`, asCaller('owner', 'DELETE'));

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(await listGrants()).toEqual(['bob']);
    });

    it('returns 404 when there is no matching grant', async () => {
      const response = await app.request(`/${SESSION_ID}/access/user/alice`, asCaller('owner', 'DELETE'));

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { message: 'No matching grant found.' } });
    });

    it('rejects an unsupported subject type', async () => {
      expect((await app.request(`/${SESSION_ID}/access/team/platform`, asCaller('owner', 'DELETE'))).status).toBe(400);
    });
  });

  describe('tenant subject', () => {
    async function shareWithTenant(subjectId = TENANT): Promise<Response> {
      return app.request(
        `/${SESSION_ID}/access`,
        jsonInit('POST', { subjects: [{ subject_type: 'tenant', subject_id: subjectId }] }),
      );
    }

    async function sessionShared(): Promise<boolean> {
      const response = await app.request(`/${SESSION_ID}`, asCaller('owner'));
      return GetSessionResponseSchema.parse(await response.json()).data.shared;
    }

    it('shares with everyone, works without a user directory, and lists with null details', async () => {
      app = buildApp({ db, sessionStore, userDirectory: new EmptyUserDirectory() });

      const response = await shareWithTenant();

      expect(response.status).toBe(201);
      expect(ListSessionAccessResponseSchema.parse(await response.json()).data).toEqual([
        expect.objectContaining({
          subject_type: 'tenant',
          subject_id: TENANT,
          subject_display_name: null,
          subject_email: null,
        }),
      ]);
      expect(await sessionShared()).toBe(true);
      expect((await app.request(`/${SESSION_ID}`, asCaller('anyone'))).status).toBe(200);
    });

    it('rejects a tenant subject for another tenant', async () => {
      const response = await shareWithTenant('other-tenant');

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({
        error: { message: 'A tenant subject must use the tenant id of the caller.' },
      });
      expect(await listGrants()).toEqual([]);
    });

    it('stops sharing with everyone once the tenant grant is revoked', async () => {
      expect((await shareWithTenant()).status).toBe(201);

      const response = await app.request(`/${SESSION_ID}/access/tenant/${TENANT}`, asCaller('owner', 'DELETE'));

      expect(response.status).toBe(200);
      expect(await sessionShared()).toBe(false);
      expect((await app.request(`/${SESSION_ID}`, asCaller('anyone'))).status).toBe(403);
    });

    it('treats PATCH { shared } as an alias for the tenant grant', async () => {
      const shared = await app.request(`/${SESSION_ID}`, jsonInit('PATCH', { shared: true }));
      expect(shared.status).toBe(200);
      expect(GetSessionResponseSchema.parse(await shared.json()).data.shared).toBe(true);
      expect(await listGrants()).toEqual([TENANT]);
      expect((await app.request(`/${SESSION_ID}`, asCaller('anyone'))).status).toBe(200);

      const unshared = await app.request(`/${SESSION_ID}`, jsonInit('PATCH', { shared: false }));
      expect(unshared.status).toBe(200);
      expect(GetSessionResponseSchema.parse(await unshared.json()).data.shared).toBe(false);
      expect(await listGrants()).toEqual([]);
      expect((await app.request(`/${SESSION_ID}`, asCaller('anyone'))).status).toBe(403);
    });

    it('ignores the legacy session.shared column', async () => {
      await sessionStore.updateSession({
        tenant_id: TENANT,
        session_id: SESSION_ID,
        agent: undefined,
        title: undefined,
        metadata: undefined,
        shared: true,
      });

      expect(await sessionShared()).toBe(false);
      expect((await app.request(`/${SESSION_ID}`, asCaller('anyone'))).status).toBe(403);
    });

    it('reports shared on listed sessions', async () => {
      expect((await shareWithTenant()).status).toBe(201);

      const response = await app.request('/', asCaller('owner'));

      expect(ListSessionsResponseSchema.parse(await response.json()).data).toEqual([
        expect.objectContaining({ id: SESSION_ID, shared: true }),
      ]);
    });
  });

  describe('read access from a grant', () => {
    const READS = [
      `/${SESSION_ID}`,
      `/${SESSION_ID}/events`,
      `/${SESSION_ID}/turns`,
      `/${SESSION_ID}/turns/${TURN_ID}`,
      `/${SESSION_ID}/turns/${TURN_ID}/events`,
    ];

    async function readStatuses(caller: string): Promise<number[]> {
      return Promise.all(READS.map(async path => (await app.request(path, asCaller(caller))).status));
    }

    beforeEach(async () => {
      await sessionStore.createTurn(makeCreateTurnInput({ sessionId: SESSION_ID, turnId: TURN_ID }));
    });

    it('lets a granted user read the session, its events, and its turns', async () => {
      expect((await grant(['alice'])).status).toBe(201);

      expect(await readStatuses('alice')).toEqual(READS.map(() => 200));
    });

    it('keeps mutations, subscribe, and downloads creator-only', async () => {
      expect((await grant(['alice'])).status).toBe(201);

      const responses = await Promise.all([
        app.request(`/${SESSION_ID}`, jsonInit('PATCH', { title: 'renamed' }, 'alice')),
        app.request(`/${SESSION_ID}`, asCaller('alice', 'DELETE')),
        app.request(`/${SESSION_ID}/cancel`, asCaller('alice', 'POST')),
        app.request(`/${SESSION_ID}/turns/${TURN_ID}/subscribe`, asCaller('alice')),
        app.request(`/${SESSION_ID}/turns/${TURN_ID}/download-sandbox-file?path=report.pdf`, asCaller('alice')),
      ]);

      expect(responses.map(response => response.status)).toEqual([403, 403, 403, 403, 403]);
    });

    it('stops read access once the grant is revoked', async () => {
      expect((await grant(['alice'])).status).toBe(201);
      expect((await app.request(`/${SESSION_ID}/access/user/alice`, asCaller('owner', 'DELETE'))).status).toBe(200);

      expect(await readStatuses('alice')).toEqual(READS.map(() => 403));
    });

    it('does not extend to users without a grant', async () => {
      expect((await grant(['alice'])).status).toBe(201);

      expect(await readStatuses('bob')).toEqual(READS.map(() => 403));
    });
  });
});
