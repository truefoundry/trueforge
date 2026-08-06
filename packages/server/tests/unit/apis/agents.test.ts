import { createAgentsRouter } from '../../../src/apis/agents';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAgentStore } from '../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';

const modelProviderBody = {
  type: 'anthropic' as const,
  name: 'anthropic',
  auth: { api_key: 'sk-ant-secret' },
  models: [
    {
      model_id: 'claude-sonnet-4-6',
      name: 'claude-sonnet-4-6',
      properties: { context_length: 200000, max_output_tokens: 32768 },
    },
  ],
};

const writeBody = {
  name: 'research',
  model: { name: 'anthropic/claude-sonnet-4-6' },
  instructions: 'Be helpful.',
};

const updateBody = {
  model: { name: 'anthropic/claude-sonnet-4-6' },
  instructions: 'Updated instructions.',
};

function jsonInit(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('agents router', () => {
  let router: ReturnType<typeof createAgentsRouter>;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const modelProviderStore = new SqliteModelProviderStore(db);
    await modelProviderStore.upsertProvider({
      tenant_id: 'default',
      name: modelProviderBody.name,
      manifest: {
        type: modelProviderBody.type,
        auth: modelProviderBody.auth,
        models: modelProviderBody.models,
      },
    });
    router = createAgentsRouter({
      agentStore: new SqliteAgentStore(db),
      modelProviderStore,
      mcpServerStore: new SqliteMcpServerStore(db),
      skillStore: new SqliteSkillStore(db),
      sandboxProviderStore: new SqliteSandboxProviderStore(db),
    });
  });

  it('POST returns a flattened Agent; PUT by immutable name keeps the same id', async () => {
    const created = await router.request('/', jsonInit('POST', writeBody));
    expect(created.status).toBe(200);
    const createdJson = (await created.json()) as {
      data: { id: string; name: string; model: { name: string }; instructions?: string };
    };
    // HTTP wire flattens store.manifest onto the response; id is allocated server-side.
    expect(createdJson.data.id.length).toBeGreaterThan(0);
    expect(createdJson.data).toMatchObject({
      name: 'research',
      model: { name: 'anthropic/claude-sonnet-4-6' },
      instructions: 'Be helpful.',
    });

    const updated = await router.request('/research', jsonInit('PUT', updateBody));
    expect(updated.status).toBe(200);
    const updatedJson = (await updated.json()) as {
      data: { id: string; name: string; instructions?: string };
    };
    expect(updatedJson.data.id).toBe(createdJson.data.id);
    expect(updatedJson.data.instructions).toBe('Updated instructions.');
  });

  it('GET returns 404 for unknown ids; PUT returns 404 for unknown names', async () => {
    const get = await router.request('/missing-agent-id');
    expect(get.status).toBe(404);

    const put = await router.request('/missing-agent', jsonInit('PUT', updateBody));
    expect(put.status).toBe(404);
  });

  it('POST rejects invalid bodies, unknown models, and duplicate names', async () => {
    const badName = await router.request('/', jsonInit('POST', { ...writeBody, name: 'Not A Name' }));
    expect(badName.status).toBe(400);

    const unknownModel = await router.request(
      '/',
      jsonInit('POST', { ...writeBody, name: 'other', model: { name: 'missing/model' } }),
    );
    expect(unknownModel.status).toBe(422);

    const first = await router.request('/', jsonInit('POST', { ...writeBody, name: 'alpha' }));
    expect(first.status).toBe(200);

    const clash = await router.request('/', jsonInit('POST', { ...writeBody, name: 'alpha' }));
    expect(clash.status).toBe(409);
  });
});
