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

  it('creates a session from an inline AgentSpec', async () => {
    const res = await app.request('/', jsonInit('POST', { agent: inlineSpec }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: {
        id: string;
        created_by: string;
        agent: { type: 'value'; agent_spec: { instructions?: string } };
      };
    };
    expect(json.data.agent.agent_spec.instructions).toBe('inline');
    expect(json.data.created_by).toBe('trueforge-default');
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
      data: { id: string; agent: { type: 'ref'; agent_id: string } };
    };
    expect(json.data.agent).toEqual({ type: 'ref', agent_id: agent.id });

    const listed = await app.request(`/?agent_id=${encodeURIComponent(agent.id)}`);
    expect(listed.status).toBe(200);
    const listJson = (await listed.json()) as {
      data: Array<{ id: string; agent: { type: 'ref'; agent_id: string } }>;
    };
    expect(listJson.data.every(row => row.agent.agent_id === agent.id)).toBe(true);
    expect(listJson.data.some(row => row.id === json.data.id)).toBe(true);
  });

  it('filters list by created_by', async () => {
    const created = await app.request('/', jsonInit('POST', { agent: inlineSpec }));
    expect(created.status).toBe(201);
    const json = (await created.json()) as { data: { id: string; created_by: string } };
    expect(json.data.created_by).toBe('trueforge-default');

    const matched = await app.request('/?created_by=trueforge-default');
    expect(matched.status).toBe(200);
    const matchedJson = (await matched.json()) as { data: Array<{ id: string; created_by: string }> };
    expect(matchedJson.data.some(row => row.id === json.data.id)).toBe(true);
    expect(matchedJson.data.every(row => row.created_by === 'trueforge-default')).toBe(true);

    const unmatched = await app.request('/?created_by=someone-else');
    expect(unmatched.status).toBe(200);
    const unmatchedJson = (await unmatched.json()) as { data: Array<{ id: string }> };
    expect(unmatchedJson.data.some(row => row.id === json.data.id)).toBe(false);
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
      jsonInit('PATCH', { agent: { ...inlineSpec, instructions: 'nope' } }),
    );
    expect(patchNamed.status).toBe(400);
  });

  it('allows PATCH agent_spec on value sessions', async () => {
    const created = await app.request('/', jsonInit('POST', { agent: inlineSpec }));
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };

    const patched = await app.request(
      `/${data.id}`,
      jsonInit('PATCH', { agent: { ...inlineSpec, instructions: 'updated' } }),
    );
    expect(patched.status).toBe(200);
    const patchedJson = (await patched.json()) as {
      data: { agent: { type: 'value'; agent_spec: { instructions?: string } } };
    };
    expect(patchedJson.data.agent.agent_spec.instructions).toBe('updated');
  });

  it('rejects create bodies that mix name and AgentSpec fields', async () => {
    const both = await app.request('/', jsonInit('POST', { agent: { name: 'named-agent', ...inlineSpec } }));
    expect(both.status).toBe(400);
  });
});
