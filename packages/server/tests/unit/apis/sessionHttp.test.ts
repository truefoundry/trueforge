import { OpenAPIHono } from '@hono/zod-openapi';
import { AgentSpecSchema, Sessions } from '@truefoundry/utils-core/agent-session';
import { RequestReplyRouter } from '@truefoundry/utils-core/request-reply';
import { createClient } from 'redis';
import { createSessionsRouter, TENANT_ID } from '../../../src/apis/sessions';
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

  beforeEach(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const sessionStore = new SqliteSessionStore(db);
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
      }),
    );
  });

  it('creates a draft session from a value agent', async () => {
    const res = await app.request('/', jsonInit('POST', { agent: { type: 'value', agent_spec: draftSpec } }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { id: string; agent: { type: string; agent_spec?: { instructions?: string } } };
    };
    expect(json.data.agent.type).toBe('value');
    expect(json.data.agent.agent_spec?.instructions).toBe('draft');
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
    expect(patchNamed.status).toBe(400);
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
