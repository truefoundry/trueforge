import { OpenAPIHono } from '@hono/zod-openapi';
import { AgentSpecSchema, Sessions } from '@truefoundry/utils-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/utils-core/request-reply';
import { createClient } from 'redis';
import { createSessionsRouter, TENANT_ID } from '../../../src/apis/sessions';
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

const draftSpec = AgentSpecSchema.parse({
  model: { name: 'anthropic/claude-sonnet-4-6' },
  instructions: 'draft',
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
      manifest: {
        type: 'anthropic',
        name: 'anthropic',
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
    app.route(
      '/',
      createSessionsRouter({
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
      }),
    );
  });

  it('creates a draft session from a value agent', async () => {
    const res = await app.request('/', jsonInit('POST', { agent: { type: 'value', agent_spec: draftSpec } }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: {
        id: string;
        created_by: string;
        agent: { type: string; agent_spec?: { instructions?: string } };
      };
    };
    expect(json.data.agent.type).toBe('value');
    expect(json.data.agent.agent_spec?.instructions).toBe('draft');
    expect(json.data.created_by).toBe(LOCAL_USER_CONTEXT.userRef);
  });

  it('returns 404 when creating a session for an unknown agent_id', async () => {
    const missing = await app.request('/', jsonInit('POST', { agent: { type: 'ref', agent_id: 'does-not-exist' } }));
    expect(missing.status).toBe(404);
  });

  it('creates a named ref session and filters list by agent_id', async () => {
    const agent = await agentStore.createAgent({
      tenant_id: TENANT_ID,
      name: 'named-agent',
      manifest: AgentSpecSchema.parse({
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'from-registry',
      }),
    });

    const created = await app.request('/', jsonInit('POST', { agent: { type: 'ref', agent_id: agent.id } }));
    expect(created.status).toBe(201);
    const json = (await created.json()) as {
      data: { id: string; agent: { type: string; agent_id?: string } };
    };
    expect(json.data.agent).toEqual({ type: 'ref', agent_id: agent.id });

    const listed = await app.request(`/?agent_id=${encodeURIComponent(agent.id)}`);
    expect(listed.status).toBe(200);
    const listJson = (await listed.json()) as {
      data: Array<{ id: string; agent: { type: string; agent_id?: string } }>;
    };
    expect(listJson.data.every(row => row.agent.type === 'ref' && row.agent.agent_id === agent.id)).toBe(true);
    expect(listJson.data.some(row => row.id === json.data.id)).toBe(true);
  });

  it("rejects access to another user's session on get/update/delete/cancel/events and scopes list", async () => {
    await sessionStore.createSession({
      tenant_id: TENANT_ID,
      session_id: 'other-user-session',
      created_by: 'someone-else',
      agent: { type: 'value', agent_spec: draftSpec },
      custom: null,
    });

    const created = await app.request('/', jsonInit('POST', { agent: { type: 'value', agent_spec: draftSpec } }));
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

  it('rejects PATCH agent on a session bound by agent_id', async () => {
    const agent = await agentStore.createAgent({
      tenant_id: TENANT_ID,
      name: 'named-agent',
      manifest: AgentSpecSchema.parse({
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'from-registry',
      }),
    });

    const created = await app.request('/', jsonInit('POST', { agent: { type: 'ref', agent_id: agent.id } }));
    expect(created.status).toBe(201);
    const json = (await created.json()) as { data: { id: string } };

    const patchNamed = await app.request(
      `/${json.data.id}`,
      jsonInit('PATCH', { agent: { type: 'value', agent_spec: { ...draftSpec, instructions: 'nope' } } }),
    );
    expect(patchNamed.status).toBe(422);
  });

  it('allows PATCH agent_spec on draft sessions', async () => {
    const created = await app.request('/', jsonInit('POST', { agent: { type: 'value', agent_spec: draftSpec } }));
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };

    const patched = await app.request(
      `/${data.id}`,
      jsonInit('PATCH', { agent: { type: 'value', agent_spec: { ...draftSpec, instructions: 'updated' } } }),
    );
    expect(patched.status).toBe(200);
    const patchedJson = (await patched.json()) as {
      data: { agent: { type: string; agent_spec?: { instructions?: string } } };
    };
    expect(patchedJson.data.agent.agent_spec?.instructions).toBe('updated');
  });

  it('rejects create bodies that mix ref and value agent fields', async () => {
    const both = await app.request(
      '/',
      jsonInit('POST', { agent: { type: 'ref', agent_id: 'x', agent_spec: draftSpec } }),
    );
    expect(both.status).toBe(400);
  });
});
