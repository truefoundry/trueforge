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
import { SqliteAccessControlStore } from '../../../src/db/sqlite/access-control-store/SqliteAccessControlStore';
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
      accessControlStore: new SqliteAccessControlStore(db),
      activeTurns: new ActiveTurnRegistry({ logger }),
      authorizer: new TrueForgeAuthorizer(),
      logger,
      redis: createClient(),
      requestReplyRouter: new RequestReplyRouter(),
      resolveAgentStore: () => agentStore,
      resolveMcpServerStore: () => new SqliteMcpServerStore(db),
      resolveModelProviderStore: () => new SqliteModelProviderStore(db),
      resolveRequestContext: c => contextFor(c.req.header(CALLER_HEADER) ?? 'owner'),
      resolveSkillStore: () => new SqliteSkillStore(db),
      sandboxEnvironmentStore: new SqliteSandboxEnvironmentStore(db),
      sandboxProviderStore: new SqliteSandboxProviderStore(db),
      sessions: new Sessions({ sessionStore }),
      sessionStore,
      userStore,
      webSearchProviderStore: new SqliteWebSearchProviderStore(db),
      withTransaction: callback => db.transaction().execute(callback),
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
    ['an unsupported subject type', { grant: [{ subject_type: 'tenant', subject_id: 'default' }] }],
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

  it('does not yet give users with a grant read access', async () => {
    expect((await update({ grant: users(['alice']) })).status).toBe(200);

    expect((await app.request(`/${SESSION_ID}`, asCaller('alice'))).status).toBe(403);
    expect((await app.request(`/${SESSION_ID}/events`, asCaller('alice'))).status).toBe(403);
  });
});
