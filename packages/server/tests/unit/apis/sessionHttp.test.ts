import { OpenAPIHono } from '@hono/zod-openapi';
import { Sessions } from '@truefoundry/utils-core/agent-session';
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

const draftSpec = {
  model: { name: 'anthropic/claude-sonnet-4-6' },
  instructions: 'draft',
};

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('sessions HTTP (agent_id XOR agent_spec)', () => {
  let app: OpenAPIHono;
  let agentStore: SqliteAgentStore;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const modelProviderStore = new SqliteModelProviderStore(db);
    await modelProviderStore.upsertProvider({
      tenant_id: TENANT_ID,
      name: 'anthropic',
      manifest: {
        type: 'anthropic',
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
    agentStore = new SqliteAgentStore(db);
    const sessionStore = new SqliteSessionStore(db);
    const sessions = new Sessions({ sessionStore });
    app = new OpenAPIHono();
    app.route(
      '/',
      createSessionsRouter({
        sessions,
        sessionStore,
        activeTurns: new ActiveTurnRegistry(),
        modelProviderStore,
        mcpServerStore: new SqliteMcpServerStore(db),
        skillStore: new SqliteSkillStore(db),
        agentStore,
        sandboxProviderStore: new SqliteSandboxProviderStore(db),
        redis: createClient(),
        requestReplyRouter: new RequestReplyRouter(),
      }),
    );
  });

  it('creates a draft session from agent_spec', async () => {
    const res = await app.request('/', jsonInit('POST', { agent_spec: draftSpec }));
    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      data: { id: string; agent_id: string | null; agent_spec: { instructions?: string } | null };
    };
    expect(json.data.agent_id).toBeNull();
    expect(json.data.agent_spec?.instructions).toBe('draft');
  });

  it('creates a named session from agent_id and rejects unknown agents', async () => {
    const agent = await agentStore.createAgent({
      tenant_id: TENANT_ID,
      name: 'named-agent',
      manifest: {
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'from-registry',
      },
    });

    const missing = await app.request('/', jsonInit('POST', { agent_id: 'does-not-exist' }));
    expect(missing.status).toBe(404);

    const created = await app.request('/', jsonInit('POST', { agent_id: agent.id }));
    expect(created.status).toBe(201);
    const json = (await created.json()) as {
      data: { id: string; agent_id: string | null; agent_spec: unknown };
    };
    expect(json.data.agent_id).toBe(agent.id);
    expect(json.data.agent_spec).toBeNull();

    const listed = await app.request(`/?agent_id=${encodeURIComponent(agent.id)}`);
    expect(listed.status).toBe(200);
    const listJson = (await listed.json()) as { data: Array<{ id: string; agent_id: string | null }> };
    expect(listJson.data.every(row => row.agent_id === agent.id)).toBe(true);
    expect(listJson.data.some(row => row.id === json.data.id)).toBe(true);

    const patchNamed = await app.request(
      `/${json.data.id}`,
      jsonInit('PATCH', { agent_spec: { ...draftSpec, instructions: 'nope' } }),
    );
    expect(patchNamed.status).toBe(400);
  });

  it('allows draft agent_spec updates and rejects create bodies with both fields', async () => {
    const created = await app.request('/', jsonInit('POST', { agent_spec: draftSpec }));
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };

    const patched = await app.request(
      `/${data.id}`,
      jsonInit('PATCH', { agent_spec: { ...draftSpec, instructions: 'updated' } }),
    );
    expect(patched.status).toBe(200);
    const patchedJson = (await patched.json()) as {
      data: { agent_spec: { instructions?: string } | null };
    };
    expect(patchedJson.data.agent_spec?.instructions).toBe('updated');

    const both = await app.request('/', jsonInit('POST', { agent_id: 'x', agent_spec: draftSpec }));
    expect(both.status).toBe(400);
  });
});
