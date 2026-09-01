import { OpenAPIHono } from '@hono/zod-openapi';
import { AgentSpecSchema, Sessions } from '@truefoundry/trueforge-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/trueforge-core/request-reply';
import { createClient } from 'redis';
import { createLogger } from 'winston';
import {
  createInternalSessionsRouter,
  createSessionsRouter,
  TENANT_ID,
  type SessionsRouterDeps,
} from '../../../src/apis/sessions';
import { LOCAL_USER_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAgentStore } from '../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSessionStore } from '../../../src/db/sqlite/session-store/SqliteSessionStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { ActiveTurnRegistry } from '../../../src/runtime/activeTurns';

const inlineSpec = AgentSpecSchema.parse({
  model: { name: 'anthropic/claude-sonnet-4-6' },
  instructions: 'inline',
});

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('sessions HTTP agent binding', () => {
  let app: OpenAPIHono;
  let agentStore: SqliteAgentStore;
  let sessionStore: SqliteSessionStore;

  beforeEach(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    sessionStore = new SqliteSessionStore(db);
    const sessions = new Sessions({ sessionStore });
    const modelProviderStore = new SqliteModelProviderStore(db);
    const mcpServerStore = new SqliteMcpServerStore(db);
    const skillStore = new SqliteSkillStore(db);
    const sandboxProviderStore = new SqliteSandboxProviderStore(db);
    agentStore = new SqliteAgentStore(db);

    await modelProviderStore.upsertProvider({
      tenant_id: TENANT_ID,
      name: 'anthropic',
      manifest: {
        type: 'anthropic',
        base_url: 'https://api.anthropic.com/v1',
        auth: { api_key: 'sk-ant-secret' },
        models: [
          {
            model_id: 'claude-sonnet-4-6',
            name: 'claude-sonnet-4-6',
            properties: { context_length: 200000, max_output_tokens: 32768 },
          },
        ],
      },
    });

    app = new OpenAPIHono();
    const deps: SessionsRouterDeps = {
      sessions,
      sessionStore,
      activeTurns: new ActiveTurnRegistry(),
      modelProviderStore,
      mcpServerStore,
      skillStore,
      agentStore,
      sandboxProviderStore,
      redis: createClient(),
      requestReplyRouter: new RequestReplyRouter(),
      resolveUserContext: () => LOCAL_USER_CONTEXT,
      logger: createLogger({ silent: true }),
    };
    app.route('/', createSessionsRouter(deps));
    app.route('/internal/sessions', createInternalSessionsRouter(deps));
  });

  it('creates a session from an inline AgentSpec', async () => {
    const res = await app.request('/', jsonInit('POST', { agent: { spec: inlineSpec } }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: {
        id: string;
        created_by: string;
        agent: { type: 'inline'; spec: { instructions?: string } };
      };
    };
    expect(json.data.agent.type).toBe('inline');
    expect(json.data.agent.spec.instructions).toBe('inline');
    expect(json.data.created_by).toBe(LOCAL_USER_CONTEXT.userRef);
  });

  it('returns 404 when creating a session for an unknown agent name', async () => {
    const missing = await app.request('/', jsonInit('POST', { agent: { name: 'does-not-exist' } }));
    expect(missing.status).toBe(404);
  });

  it('creates a named session and filters list by agent_id', async () => {
    const agent = await agentStore.createAgent({
      tenant_id: TENANT_ID,
      name: 'named-agent',
      manifest: AgentSpecSchema.parse({
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'from-registry',
      }),
    });

    const created = await app.request('/', jsonInit('POST', { agent: { name: agent.name } }));
    expect(created.status).toBe(201);
    const json = (await created.json()) as {
      data: { id: string; agent: { type: 'reference'; id: string; name: string | null } };
    };
    expect(json.data.agent).toEqual({ type: 'reference', id: agent.id, name: agent.name });

    const listed = await app.request(`/?agent_id=${encodeURIComponent(agent.id)}`);
    expect(listed.status).toBe(200);
    const listJson = (await listed.json()) as {
      data: Array<{ id: string; agent: { type: 'reference'; id: string; name: string | null } }>;
    };
    expect(listJson.data.every(row => row.agent.id === agent.id)).toBe(true);
    expect(listJson.data.some(row => row.id === json.data.id)).toBe(true);
  });

  it("rejects access to another user's session on get/update/delete/cancel/events and scopes list", async () => {
    await sessionStore.createSession({
      tenant_id: TENANT_ID,
      session_id: 'other-user-session',
      created_by: 'someone-else',
      agent: { type: 'inline', spec: inlineSpec },
      custom: null,
      external_id: null,
    });

    const created = await app.request('/', jsonInit('POST', { agent: { spec: inlineSpec } }));
    expect(created.status).toBe(201);
    const json = (await created.json()) as { data: { id: string; created_by: string } };
    expect(json.data.created_by).toBe(LOCAL_USER_CONTEXT.userRef);

    const listed = await app.request('/');
    expect(listed.status).toBe(200);
    const listedJson = (await listed.json()) as { data: Array<{ id: string; created_by: string }> };
    expect(listedJson.data.map(row => row.id)).toEqual([json.data.id]);
    expect(listedJson.data.every(row => row.created_by === LOCAL_USER_CONTEXT.userRef)).toBe(true);

    const forbiddenBody = { error: { message: 'Only the session creator can access this session' } };

    const getForbidden = await app.request('/other-user-session');
    expect(getForbidden.status).toBe(403);
    expect(await getForbidden.json()).toEqual(forbiddenBody);

    const patchForbidden = await app.request('/other-user-session', jsonInit('PATCH', {}));
    expect(patchForbidden.status).toBe(403);
    expect(await patchForbidden.json()).toEqual(forbiddenBody);

    const deleteForbidden = await app.request('/other-user-session', { method: 'DELETE' });
    expect(deleteForbidden.status).toBe(403);
    expect(await deleteForbidden.json()).toEqual(forbiddenBody);

    const cancelForbidden = await app.request('/other-user-session/cancel', { method: 'POST' });
    expect(cancelForbidden.status).toBe(403);
    expect(await cancelForbidden.json()).toEqual(forbiddenBody);

    const eventsForbidden = await app.request('/other-user-session/events');
    expect(eventsForbidden.status).toBe(403);
    expect(await eventsForbidden.json()).toEqual(forbiddenBody);

    const allowed = await app.request(`/${json.data.id}`);
    expect(allowed.status).toBe(200);
  });

  it('rejects PATCH agent on a named session', async () => {
    const agent = await agentStore.createAgent({
      tenant_id: TENANT_ID,
      name: 'named-agent',
      manifest: AgentSpecSchema.parse({
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'from-registry',
      }),
    });

    const created = await app.request('/', jsonInit('POST', { agent: { name: agent.name } }));
    expect(created.status).toBe(201);
    const json = (await created.json()) as { data: { id: string } };

    const patchNamed = await app.request(
      `/${json.data.id}`,
      jsonInit('PATCH', { agent: { spec: { ...inlineSpec, instructions: 'nope' } } }),
    );
    expect(patchNamed.status).toBe(422);
  });

  it('allows PATCH agent.spec on inline sessions', async () => {
    const created = await app.request('/', jsonInit('POST', { agent: { spec: inlineSpec } }));
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };

    const patched = await app.request(
      `/${data.id}`,
      jsonInit('PATCH', { agent: { spec: { ...inlineSpec, instructions: 'updated' } } }),
    );
    expect(patched.status).toBe(200);
    const patchedJson = (await patched.json()) as {
      data: { agent: { type: 'inline'; spec: { instructions?: string } } };
    };
    expect(patchedJson.data.agent.spec.instructions).toBe('updated');
  });

  it('POST get-or-create-by-external-id is idempotent and 403s for another creator', async () => {
    const publicPath = await app.request(
      '/get-or-create-by-external-id',
      jsonInit('POST', { external_id: 'run-abc', agent: { spec: inlineSpec } }),
    );
    expect(publicPath.status).toBe(404);

    const created = await app.request(
      '/internal/sessions/get-or-create-by-external-id',
      jsonInit('POST', { external_id: 'run-abc', agent: { spec: inlineSpec } }),
    );
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as {
      data: { id: string; agent: { type: 'inline'; spec: { instructions?: string } } };
    };
    expect(createdJson.data.agent.spec.instructions).toBe('inline');

    const again = await app.request(
      '/internal/sessions/get-or-create-by-external-id',
      jsonInit('POST', {
        external_id: 'run-abc',
        agent: { spec: { ...inlineSpec, instructions: 'ignored-on-get' } },
      }),
    );
    expect(again.status).toBe(200);
    const againJson = (await again.json()) as {
      data: { id: string; agent: { type: 'inline'; spec: { instructions?: string } } };
    };
    expect(againJson.data.id).toBe(createdJson.data.id);
    expect(againJson.data.agent.spec.instructions).toBe('inline');

    await sessionStore.createSession({
      tenant_id: TENANT_ID,
      session_id: 'someone-elses-session',
      created_by: 'someone-else',
      agent: { type: 'inline', spec: inlineSpec },
      custom: null,
      external_id: 'run-theirs',
    });
    const forbidden = await app.request(
      '/internal/sessions/get-or-create-by-external-id',
      jsonInit('POST', { external_id: 'run-theirs', agent: { spec: inlineSpec } }),
    );
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: { message: 'Only the session creator can access this session' },
    });
  });

  it('rejects create bodies that mix name and AgentSpec fields', async () => {
    const both = await app.request('/', jsonInit('POST', { agent: { name: 'named-agent', ...inlineSpec } }));
    expect(both.status).toBe(400);
  });
});
