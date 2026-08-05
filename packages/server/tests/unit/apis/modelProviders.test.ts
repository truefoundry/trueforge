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

const model = {
  model_id: 'claude-sonnet-4-6',
  name: 'claude-sonnet-4-6',
  properties: { context_length: 200000, max_output_tokens: 32768, reasoning_efforts: ['low', 'high'] },
};

const anthropicBody = {
  type: 'anthropic' as const,
  name: 'anthropic',
  auth: { api_key: 'sk-ant-secret' },
  models: [model],
};

const customBody = {
  type: 'custom' as const,
  name: 'internal',
  base_url: 'https://llm.internal.example.com/v1',
  auth: { api_key: 'sk-custom' },
  models: [model],
};

function putInit(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

async function createRouters(): Promise<{
  settingsRouter: ReturnType<typeof createSettingsRouter>;
  modelsRouter: ReturnType<typeof createModelsRouter>;
}> {
  const db = createSqliteDb(':memory:');
  await migrateSqliteToLatest(db);
  const modelProviderStore = new SqliteModelProviderStore(db);
  return {
    settingsRouter: createSettingsRouter({
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
    }),
    modelsRouter: createModelsRouter(modelProviderStore),
  };
}

describe('settings model-providers and models routers', () => {
  let settingsRouter: ReturnType<typeof createSettingsRouter>;
  let modelsRouter: ReturnType<typeof createModelsRouter>;

  beforeAll(async () => {
    ({ settingsRouter, modelsRouter } = await createRouters());
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

  it('PUT upserts a well-known provider without base_url and echoes the stored auth', async () => {
    const response = await settingsRouter.request('/model-providers', putInit(anthropicBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: anthropicBody });

    const list = await settingsRouter.request('/model-providers');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ data: [anthropicBody] });
  });

  it('PUT requires base_url for custom providers', async () => {
    const { base_url: _, ...withoutBaseUrl } = customBody;
    const missingBaseUrl = await settingsRouter.request('/model-providers', putInit(withoutBaseUrl));
    expect(missingBaseUrl.status).toBe(400);

    const created = await settingsRouter.request('/model-providers', putInit(customBody));
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ data: customBody });
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const badName = await settingsRouter.request('/model-providers', putInit({ ...anthropicBody, name: 'Not A Name' }));
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
          properties: model.properties,
        },
        {
          name: 'internal/claude-sonnet-4-6',
          model_id: 'claude-sonnet-4-6',
          properties: model.properties,
        },
      ],
    });
  });
});

describe('catalog presets are configurable', () => {
  // A preset is meant to be copied into a PUT body with an api_key added. Every type the catalog
  // ships must therefore be in the configuration union; five of them once were not.
  it.each(ModelCatalog.load().list())('PUT accepts the $type preset', async preset => {
    const { settingsRouter } = await createRouters();
    // `logo` is catalog-only discovery metadata — omit it from the configured PUT body.
    const { logo, ...presetWithoutLogo } = preset;
    const body = {
      ...presetWithoutLogo,
      auth: { api_key: `sk-${preset.name}` },
      // Alibaba is the one catalog type that also needs a base_url: a MaaS host embeds the
      // workspace id, so there is nothing to default to.
      ...(preset.type === 'alibaba' ? { base_url: 'https://ws-x.ap-southeast-1.maas.aliyuncs.com/v1' } : {}),
    };
    expect(logo === undefined || typeof logo === 'string').toBe(true);
    const response = await settingsRouter.request('/model-providers', putInit(body));
    expect(response.status).toBe(200);
  });
});
