import { createAgentsRouter } from '../../../src/apis/agents';
import { STANDALONE_REQUEST_CONTEXT } from '../../../src/auth/identity';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { SqliteAgentStore } from '../../../src/db/sqlite/agent-store/SqliteAgentStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';

const modelProvider = {
  type: 'anthropic' as const,
  base_url: 'https://api.anthropic.com/v1',
  auth: { api_key: 'sk-ant-secret' },
  models: [
    {
      model_id: 'claude-sonnet-4-6',
      name: 'claude-sonnet-4-6',
      properties: { context_length: 200000, max_output_tokens: 32768 },
    },
  ],
};

const manifest = {
  model: { name: 'anthropic/claude-sonnet-4-6' },
  instructions: 'Be helpful.',
  config: {
    context_management: {
      compaction: {
        enabled: true,
        trigger: { type: 'input_tokens', value: 80_000 },
      },
    },
  },
};

const writeBody = {
  name: 'research',
  manifest,
};

const updateBody = {
  manifest: {
    model: { name: 'anthropic/claude-sonnet-4-6' },
    instructions: 'Updated instructions.',
  },
};

type WireAgent = {
  id: string;
  name: string;
  manifest: {
    model: { name: string };
    instructions?: string;
    config?: {
      context_management?: {
        compaction?: { enabled: boolean; trigger?: { type: 'input_tokens'; value: number } };
      };
    };
  };
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
  let agentStore: SqliteAgentStore;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const modelProviderStore = new SqliteModelProviderStore(db);
    await modelProviderStore.upsertProvider({ tenant_id: 'default', name: 'anthropic', manifest: modelProvider });
    agentStore = new SqliteAgentStore(db);
    router = createAgentsRouter({
      resolveAgentStore: () => agentStore,
      resolveModelProviderStore: () => modelProviderStore,
      resolveMcpServerStore: () => new SqliteMcpServerStore(db),
      skillStore: new SqliteSkillStore(db),
      resolveSandboxProviderStore: () => new SqliteSandboxProviderStore(db),
      withTransaction: callback => db.transaction().execute(callback),
      resolveRequestContext: () => STANDALONE_REQUEST_CONTEXT,
    });
  });

  it('POST returns a wrapped Agent; PUT by immutable id keeps the same id', async () => {
    const created = await router.request('/', jsonInit('POST', writeBody));
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as { data: WireAgent };
    expect(createdJson.data.id.length).toBeGreaterThan(0);
    expect(createdJson.data).toMatchObject({
      name: 'research',
      manifest: {
        model: { name: 'anthropic/claude-sonnet-4-6' },
        instructions: 'Be helpful.',
        config: {
          context_management: {
            compaction: {
              enabled: true,
              trigger: { type: 'input_tokens', value: 80_000 },
            },
          },
        },
      },
    });
    expect(createdJson.data).not.toHaveProperty('metadata');

    const updated = await router.request(`/${createdJson.data.id}`, jsonInit('PUT', updateBody));
    expect(updated.status).toBe(200);
    const updatedJson = (await updated.json()) as { data: WireAgent };
    expect(updatedJson.data.id).toBe(createdJson.data.id);
    expect(updatedJson.data.name).toBe('research');
    expect(updatedJson.data.manifest.instructions).toBe('Updated instructions.');
    expect(updatedJson.data).not.toHaveProperty('metadata');
  });

  it('PUT rejects metadata in the request body', async () => {
    const created = await router.request('/', jsonInit('POST', { ...writeBody, name: 'no-meta' }));
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as { data: WireAgent };

    const put = await router.request(`/${createdJson.data.id}`, jsonInit('PUT', { ...updateBody, metadata: {} }));
    expect(put.status).toBe(400);
  });

  it('GET and PUT return 404 for unknown ids', async () => {
    const get = await router.request('/missing-agent-id');
    expect(get.status).toBe(404);

    const put = await router.request('/missing-agent-id', jsonInit('PUT', updateBody));
    expect(put.status).toBe(404);

    const snippets = await router.request('/missing-agent-id/code-snippets');
    expect(snippets.status).toBe(404);
  });

  it('GET code-snippets returns snippets for an existing agent', async () => {
    const created = await router.request('/', jsonInit('POST', { ...writeBody, name: 'snippet-bot' }));
    expect(created.status).toBe(201);
    const createdJson = (await created.json()) as { data: WireAgent };

    const response = await router.request(`/${createdJson.data.id}/code-snippets`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { snippets: unknown[] } };
    expect(body.data.snippets.length).toBeGreaterThan(0);
  });

  it('DELETE removes an agent by id and is idempotent', async () => {
    const created = await router.request('/', jsonInit('POST', { ...writeBody, name: 'deletable' }));
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string } };

    const deleted = await router.request(`/${data.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({});

    expect((await router.request(`/${data.id}`)).status).toBe(404);
    const deletedAgain = await router.request(`/${data.id}`, { method: 'DELETE' });
    expect(deletedAgain.status).toBe(200);
    expect(await deletedAgain.json()).toEqual({});
  });

  it('POST rejects invalid bodies, unknown models, and duplicate names', async () => {
    const badName = await router.request('/', jsonInit('POST', { ...writeBody, name: 'Not A Name' }));
    expect(badName.status).toBe(400);

    const reservedTfg = await router.request('/', jsonInit('POST', { ...writeBody, name: 'tfg' }));
    expect(reservedTfg.status).toBe(400);

    const reservedTrueforge = await router.request('/', jsonInit('POST', { ...writeBody, name: 'trueforge' }));
    expect(reservedTrueforge.status).toBe(400);

    const unknownModel = await router.request(
      '/',
      jsonInit('POST', {
        name: 'other',
        manifest: { ...manifest, model: { name: 'missing/model' } },
      }),
    );
    expect(unknownModel.status).toBe(422);

    const first = await router.request('/', jsonInit('POST', { ...writeBody, name: 'alpha' }));
    expect(first.status).toBe(201);

    const clash = await router.request('/', jsonInit('POST', { ...writeBody, name: 'alpha' }));
    expect(clash.status).toBe(409);
  });
});
