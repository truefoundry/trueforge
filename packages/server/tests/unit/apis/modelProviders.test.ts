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
  auth: { api_key: 'sk-ant-secret' },
  models: [model],
};

/** What the body above is stored and echoed as: named after its type, endpoint from its schema. */
const anthropicProvider = { ...anthropicBody, name: 'anthropic', base_url: 'https://api.anthropic.com/v1' };

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
    expect(await response.json()).toEqual({ data: anthropicProvider });

    const list = await settingsRouter.request('/model-providers');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ data: [anthropicProvider] });
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

describe('well-known types are limited to one provider', () => {
  it('PUT replaces the configured provider instead of adding a second of the type', async () => {
    const { settingsRouter, modelsRouter } = await createRouters();
    expect((await settingsRouter.request('/model-providers', putInit(anthropicBody))).status).toBe(200);

    const rotated = { ...anthropicBody, auth: { api_key: 'sk-ant-rotated' } };
    const update = await settingsRouter.request('/model-providers', putInit(rotated));
    expect(update.status).toBe(200);
    expect(await update.json()).toEqual({ data: { ...anthropicProvider, auth: rotated.auth } });

    const list = await settingsRouter.request('/model-providers');
    expect(await list.json()).toEqual({ data: [{ ...anthropicProvider, auth: rotated.auth }] });
    const models = await modelsRouter.request('/');
    expect(((await models.json()) as { data: { name: string }[] }).data.map(entry => entry.name)).toEqual([
      'anthropic/claude-sonnet-4-6',
    ]);
  });

  it('PUT rejects a name of its own for a well-known type', async () => {
    const { settingsRouter } = await createRouters();
    const named = await settingsRouter.request('/model-providers', putInit({ ...anthropicBody, name: 'anthropic-eu' }));
    expect(named.status).toBe(400);

    const list = await settingsRouter.request('/model-providers');
    expect(await list.json()).toEqual({ data: [] });
  });

  it('PUT keeps a caller-supplied base_url over the schema default', async () => {
    const { settingsRouter } = await createRouters();
    const proxied = { ...anthropicBody, base_url: 'https://gateway.internal.example.com/v1' };
    const response = await settingsRouter.request('/model-providers', putInit(proxied));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: { ...anthropicProvider, base_url: proxied.base_url } });
  });

  it('PUT allows several caller-supplied providers, which each name their own endpoint', async () => {
    const { settingsRouter } = await createRouters();
    const second = { ...customBody, name: 'internal-eu', base_url: 'https://llm.eu.example.com/v1' };
    expect((await settingsRouter.request('/model-providers', putInit(customBody))).status).toBe(200);
    expect((await settingsRouter.request('/model-providers', putInit(second))).status).toBe(200);

    const list = await settingsRouter.request('/model-providers');
    expect(await list.json()).toEqual({ data: [customBody, second] });
  });
});

describe('catalog presets are configurable', () => {
  // A preset is copied into a PUT body with an api_key added, so every catalog type must parse.
  it.each(ModelCatalog.load().list())('PUT accepts the $type preset', async preset => {
    const { settingsRouter } = await createRouters();
    // `logo` is catalog-only metadata; everything else copies straight into a PUT body.
    const { logo, ...presetWithoutLogo } = preset;
    const body = {
      ...presetWithoutLogo,
      auth: { api_key: `sk-${preset.name}` },
    };
    expect(logo === undefined || typeof logo === 'string').toBe(true);
    const response = await settingsRouter.request('/model-providers', putInit(body));
    expect(response.status).toBe(200);
  });
});
