import winston from 'winston';
import { createModelsRouter } from '../../../src/apis/models';
import { createSettingsRouter } from '../../../src/apis/settings';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { ModelCatalog } from '../../../src/catalog/ModelCatalog';
import { SandboxCatalog } from '../../../src/catalog/SandboxCatalog';
import { SkillCatalog } from '../../../src/catalog/SkillCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';

const putBody = {
  type: 'anthropic',
  name: 'anthropic',
  base_url: 'https://api.anthropic.com/v1',
  auth: { api_key: 'sk-ant-secret' },
  models: [
    {
      model_id: 'claude-sonnet-4-6',
      name: 'claude-sonnet-4-6',
      properties: { context_length: 200000, max_output_tokens: 32768, reasoning_efforts: ['low', 'high'] },
    },
  ],
};

function putInit(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('settings model-providers and models routers', () => {
  let settingsRouter: ReturnType<typeof createSettingsRouter>;
  let modelsRouter: ReturnType<typeof createModelsRouter>;

  beforeAll(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const modelProviderStore = new SqliteModelProviderStore(db);
    settingsRouter = createSettingsRouter({
      modelCatalog: ModelCatalog.load(),
      modelProviderStore,
      mcpCatalog: McpCatalog.load(),
      mcpServerStore: new SqliteMcpServerStore(db),
      tokenStore: new SqliteOAuthTokenStore(db),
      skillCatalog: SkillCatalog.load(),
      skillStore: new SqliteSkillStore(db),
      sandboxCatalog: SandboxCatalog.load(),
      sandboxProviderStore: new SqliteSandboxProviderStore(db),
      logger: winston.createLogger({ silent: true }),
    });
    modelsRouter = createModelsRouter(modelProviderStore);
  });

  it('GET /model-providers/catalog returns the shipped catalog verbatim', async () => {
    const response = await settingsRouter.request('/model-providers/catalog');
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { type: string; name: string }[] };
    expect(body.data.map(provider => provider.name)).toEqual(
      ModelCatalog.load()
        .list()
        .map(provider => provider.name),
    );
    expect(body.data.every(provider => provider.type !== 'custom')).toBe(true);
  });

  it('PUT upserts a provider and echoes the stored auth', async () => {
    const response = await settingsRouter.request('/model-providers', putInit(putBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: putBody });

    const list = await settingsRouter.request('/model-providers');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ data: [putBody] });
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const { base_url: _, ...withoutBaseUrl } = putBody;
    const missingBaseUrl = await settingsRouter.request('/model-providers', putInit(withoutBaseUrl));
    expect(missingBaseUrl.status).toBe(400);

    const badName = await settingsRouter.request('/model-providers', putInit({ ...putBody, name: 'Not A Name' }));
    expect(badName.status).toBe(400);
  });

  it('GET /models returns the FQN read view', async () => {
    const response = await modelsRouter.request('/');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: [
        {
          name: 'anthropic/claude-sonnet-4-6',
          model_id: 'claude-sonnet-4-6',
          properties: putBody.models[0]?.properties,
        },
      ],
    });
  });
});
