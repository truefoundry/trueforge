import { OpenAPIHono } from '@hono/zod-openapi';
import { AgentSpecSchema, Sessions } from '@truefoundry/trueforge-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import type { Kysely } from 'kysely';
import { createClient } from 'redis';
import { createLogger } from 'winston';
import { createSessionsRouter } from '../../../src/apis/sessions';
import { createAppErrorHandler } from '../../../src/app';
import { TrueForgeAuthorizer } from '../../../src/auth/authorizer';
import type { RequestContext } from '../../../src/auth/identity';
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
import type { Database } from '../../../src/db/sqlite/types';
import { SqliteWebSearchProviderStore } from '../../../src/db/sqlite/web-search-provider-store/SqliteWebSearchProviderStore';
import { EmptyUserStore, type IUserStore } from '../../../src/db/userStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';
import { ListSessionGrantsResponseSchema } from '../../../src/schemas/sessionGrant';
import type { User } from '../../../src/schemas/user';

const TENANT = 'default';
const SESSION_ID = 'shared-session';
const CALLER_HEADER = 'x-test-caller';

const USERS: User[] = [
  { id: 'alice', display_name: 'Alice', email: 'alice@example.com' },
  { id: 'bob', display_name: 'Bob', email: 'bob@example.com' },
];

function contextFor(subjectId: string): RequestContext {
  return {
    tenant_id: TENANT,
    subject: { id: subjectId, type: 'user', display_name: subjectId },
    roles: [],
    user_credential: null,
  };
}

class FakeUserStore implements IUserStore {
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
  const logger = createLogger({ silent: true });
  const app = new OpenAPIHono();
  app.route(
    '/',
    createSessionsRouter({
      sessions: new Sessions({ sessionStore }),
      sessionStore,
      accessControlEntryStore: new SqliteAccessControlEntryStore(db),
      userStore,
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
      resolveRequestContext: c => contextFor(c.req.header(CALLER_HEADER) ?? 'owner'),
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
    return ListSessionGrantsResponseSchema.parse(await response.json()).data.map(access => access.subject.subject_id);
  }

  function userSubjects(subjectIds: string[]) {
    return { subjects: subjectIds.map(subject_id => ({ subject_type: 'user', subject_id })) };
  }

  async function share(subjectIds: string[]): Promise<Response> {
    return app.request(`/${SESSION_ID}/grants`, jsonInit('POST', userSubjects(subjectIds)));
  }

  describe('access rules', () => {
    it('rejects callers other than the session creator', async () => {
      const forbidden = { error: { message: 'Only the session creator can manage access to this session' } };

      const list = await app.request(`/${SESSION_ID}/grants`, asCaller('alice'));
      expect(list.status).toBe(403);
      expect(await list.json()).toEqual(forbidden);

      const create = await app.request(`/${SESSION_ID}/grants`, jsonInit('POST', userSubjects(['bob']), 'alice'));
      expect(create.status).toBe(403);

      const remove = await app.request(
        `/${SESSION_ID}/grants?subject_type=user&subject_id=bob`,
        asCaller('alice', 'DELETE'),
      );
      expect(remove.status).toBe(403);
    });

    it('returns 404 for an unknown session', async () => {
      expect((await app.request('/missing/grants', asCaller('owner'))).status).toBe(404);
      expect((await app.request('/missing/grants', jsonInit('POST', userSubjects(['alice'])))).status).toBe(404);
      expect(
        (await app.request('/missing/grants?subject_type=user&subject_id=alice', asCaller('owner', 'DELETE'))).status,
      ).toBe(404);
    });
  });

  describe('create', () => {
    it('shares with users and returns every subject with access', async () => {
      const response = await share(['alice', 'bob']);

      expect(response.status).toBe(201);
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
      expect((await share(['alice', 'alice'])).status).toBe(201);
      expect(fakeUserStore.getUsersByIdsCalls[0]).toEqual(['alice']);

      const again = await share(['alice']);
      expect(again.status).toBe(201);
      expect(
        ListSessionGrantsResponseSchema.parse(await again.json()).data.map(access => access.subject.subject_id),
      ).toEqual(['alice']);
    });

    it('rejects sharing with the session creator', async () => {
      const response = await share(['owner']);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'The session creator already has access.' } });
    });

    it('rejects unknown users without writing anything', async () => {
      const response = await share(['alice', 'ghost', 'phantom']);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'Unknown users: ghost, phantom' } });
      expect(await listSubjectIds()).toEqual([]);
    });

    it('rejects every user when no user store is configured', async () => {
      app = buildApp({ db, sessionStore, userStore: new EmptyUserStore() });

      const response = await share(['alice']);

      expect(response.status).toBe(422);
      expect(await response.json()).toEqual({ error: { message: 'Unknown users: alice' } });
    });

    it.each([
      ['an empty subject list', { subjects: [] }],
      ['more than 50 subjects', userSubjects(Array.from({ length: 51 }, (_, i) => `u${String(i)}`))],
      ['an unsupported subject type', { subjects: [{ subject_type: 'tenant', subject_id: 'default' }] }],
    ])('rejects %s', async (_label, body) => {
      const response = await app.request(`/${SESSION_ID}/grants`, jsonInit('POST', body));
      expect(response.status).toBe(400);
    });
  });

  describe('list', () => {
    it('lists subjects without looking up users', async () => {
      expect((await share(['alice'])).status).toBe(201);
      const callsAfterShare = fakeUserStore.getUsersByIdsCalls.length;

      const response = await app.request(`/${SESSION_ID}/grants`, asCaller('owner'));

      expect(response.status).toBe(200);
      expect(ListSessionGrantsResponseSchema.parse(await response.json()).data).toEqual([
        expect.objectContaining({ subject: { subject_type: 'user', subject_id: 'alice' } }),
      ]);
      expect(fakeUserStore.getUsersByIdsCalls).toHaveLength(callsAfterShare);
    });
  });

  describe('delete', () => {
    it('revokes an existing subject', async () => {
      expect((await share(['alice', 'bob'])).status).toBe(201);

      const response = await app.request(
        `/${SESSION_ID}/grants?subject_type=user&subject_id=alice`,
        asCaller('owner', 'DELETE'),
      );

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({});
      expect(await listSubjectIds()).toEqual(['bob']);
    });

    it('returns 404 when the subject does not have access', async () => {
      const response = await app.request(
        `/${SESSION_ID}/grants?subject_type=user&subject_id=alice`,
        asCaller('owner', 'DELETE'),
      );

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: { message: 'Subject does not have access to this session.' } });
    });

    it('rejects an unsupported subject type', async () => {
      expect(
        (await app.request(`/${SESSION_ID}/grants?subject_type=tenant&subject_id=default`, asCaller('owner', 'DELETE')))
          .status,
      ).toBe(400);
    });

    it.each([
      ['no query parameters', ''],
      ['a missing subject_id', '?subject_type=user'],
      ['a missing subject_type', '?subject_id=alice'],
      ['an empty subject_id', '?subject_type=user&subject_id='],
    ])('rejects %s without revoking anything', async (_label, query) => {
      expect((await share(['alice'])).status).toBe(201);

      const response = await app.request(`/${SESSION_ID}/grants${query}`, asCaller('owner', 'DELETE'));

      expect(response.status).toBe(400);
      expect(await listSubjectIds()).toEqual(['alice']);
    });
  });

  it('does not yet give users with access read access', async () => {
    expect((await share(['alice'])).status).toBe(201);

    expect((await app.request(`/${SESSION_ID}`, asCaller('alice'))).status).toBe(403);
    expect((await app.request(`/${SESSION_ID}/events`, asCaller('alice'))).status).toBe(403);
  });
});
