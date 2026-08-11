import winston from 'winston';
import { createModelsRouter } from '../../../src/apis/models';
import { TENANT_ID } from '../../../src/apis/sessions';
import { createSettingsRouter } from '../../../src/apis/settings';
import { LOCAL_USER_CONTEXT } from '../../../src/auth/identity';
import { McpCatalog } from '../../../src/catalog/McpCatalog';
import { ModelCatalog } from '../../../src/catalog/ModelCatalog';
import { SandboxCatalog } from '../../../src/catalog/SandboxCatalog';
import { SkillCatalog } from '../../../src/catalog/SkillCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import type { IModelProviderStore } from '../../../src/db/modelProviderStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { SqliteOAuthTokenStore } from '../../../src/db/sqlite/token-store/SqliteOAuthTokenStore';
import { toRedactedSecretValue } from '../../../src/utils/secretRedaction';

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

/** What the body above is stored as: no name of its own, endpoint from its schema. */
const anthropicProvider = { ...anthropicBody, base_url: 'https://api.anthropic.com/v1' };

/** Wire view of anthropicProvider (secrets redacted). */
const anthropicProviderWire = {
  ...anthropicProvider,
  auth: { api_key: toRedactedSecretValue(anthropicProvider.auth.api_key) },
};

const customBody = {
  type: 'custom' as const,
  name: 'internal',
  base_url: 'https://llm.internal.example.com/v1',
  auth: { api_key: 'sk-custom' },
  models: [model],
};

const customBodyWire = {
  ...customBody,
  auth: { api_key: toRedactedSecretValue(customBody.auth.api_key) },
};

function putInit(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function withRedactedApiKey<T extends { auth: { api_key: string } }>(provider: T): T {
  return {
    ...provider,
    auth: { api_key: toRedactedSecretValue(provider.auth.api_key) },
  };
}

async function createRouters(): Promise<{
  settingsRouter: ReturnType<typeof createSettingsRouter>;
  modelsRouter: ReturnType<typeof createModelsRouter>;
  modelProviderStore: IModelProviderStore;
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
      withTransaction: callback => db.transaction().execute(callback),
      logger: winston.createLogger({ silent: true }),
      resolveUserContext: () => LOCAL_USER_CONTEXT,
    }),
    modelsRouter: createModelsRouter({
      modelProviderStore,
      withTransaction: callback => db.transaction().execute(callback),
    }),
    modelProviderStore,
  };
}

describe('settings model-providers and models routers', () => {
  let settingsRouter: ReturnType<typeof createSettingsRouter>;
  let modelsRouter: ReturnType<typeof createModelsRouter>;

  beforeAll(async () => {
    ({ settingsRouter, modelsRouter } = await createRouters());
  });

  it('GET /model-providers/catalog returns shipped presets plus a custom sentinel', async () => {
    const response = await settingsRouter.request('/model-providers/catalog');
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data: { type: string; supported_reasoning_efforts?: string[] }[];
    };
    const shipped = ModelCatalog.load().list();
    expect(body.data.slice(0, -1)).toEqual([...shipped]);
    expect(body.data.at(-1)).toEqual({
      type: 'custom',
      supported_reasoning_efforts: ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    });
  });

  it('PUT upserts a well-known provider without base_url and returns redacted auth', async () => {
    const response = await settingsRouter.request('/model-providers', putInit(anthropicBody));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ data: anthropicProviderWire });

    const list = await settingsRouter.request('/model-providers');
    expect(list.status).toBe(200);
    expect(await list.json()).toEqual({ data: [anthropicProviderWire] });
  });

  it('PUT requires base_url for custom providers', async () => {
    const { base_url: _, ...withoutBaseUrl } = customBody;
    const missingBaseUrl = await settingsRouter.request('/model-providers', putInit(withoutBaseUrl));
    expect(missingBaseUrl.status).toBe(400);

    const created = await settingsRouter.request('/model-providers', putInit(customBody));
    expect(created.status).toBe(200);
    expect(await created.json()).toEqual({ data: customBodyWire });
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const badName = await settingsRouter.request('/model-providers', putInit({ ...customBody, name: 'Not A Name' }));
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
    expect(await update.json()).toEqual({
      data: withRedactedApiKey({ ...anthropicProvider, auth: rotated.auth }),
    });

    const list = await settingsRouter.request('/model-providers');
    expect(await list.json()).toEqual({
      data: [withRedactedApiKey({ ...anthropicProvider, auth: rotated.auth })],
    });
    const models = await modelsRouter.request('/');
    expect(((await models.json()) as { data: { name: string }[] }).data.map(entry => entry.name)).toEqual([
      'anthropic/claude-sonnet-4-6',
    ]);
  });

  it('PUT takes no name for a well-known type, not even its own', async () => {
    const { settingsRouter } = await createRouters();
    const sibling = await settingsRouter.request(
      '/model-providers',
      putInit({ ...anthropicBody, name: 'anthropic-eu' }),
    );
    expect(sibling.status).toBe(400);
    const echoed = await settingsRouter.request('/model-providers', putInit({ ...anthropicBody, name: 'anthropic' }));
    expect(echoed.status).toBe(400);

    const list = await settingsRouter.request('/model-providers');
    expect(await list.json()).toEqual({ data: [] });
  });

  it('PUT keeps a caller-supplied base_url over the schema default', async () => {
    const { settingsRouter } = await createRouters();
    const proxied = { ...anthropicBody, base_url: 'https://gateway.internal.example.com/v1' };
    const response = await settingsRouter.request('/model-providers', putInit(proxied));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: withRedactedApiKey({ ...anthropicProvider, base_url: proxied.base_url }),
    });
  });

  it('PUT allows several caller-supplied providers, which each name their own endpoint', async () => {
    const { settingsRouter } = await createRouters();
    const second = { ...customBody, name: 'internal-eu', base_url: 'https://llm.eu.example.com/v1' };
    expect((await settingsRouter.request('/model-providers', putInit(customBody))).status).toBe(200);
    expect((await settingsRouter.request('/model-providers', putInit(second))).status).toBe(200);

    const list = await settingsRouter.request('/model-providers');
    expect(await list.json()).toEqual({
      data: [customBodyWire, withRedactedApiKey(second)],
    });
  });
});

describe('model-provider secret redaction and strict PUT', () => {
  it('PUT create with a redacted api_key returns 400', async () => {
    const { settingsRouter } = await createRouters();
    const response = await settingsRouter.request(
      '/model-providers',
      putInit({
        ...anthropicBody,
        auth: { api_key: toRedactedSecretValue('sk-ant-secret') },
      }),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: { message: 'API key is required' } });
  });

  it('PUT rejects a missing api_key at the Zod layer', async () => {
    const { settingsRouter } = await createRouters();
    const response = await settingsRouter.request('/model-providers', putInit({ ...anthropicBody, auth: {} }));
    expect(response.status).toBe(400);
  });

  it('PUT with a redacted api_key keeps the stored secret', async () => {
    const { settingsRouter, modelProviderStore } = await createRouters();
    expect((await settingsRouter.request('/model-providers', putInit(anthropicBody))).status).toBe(200);

    const redactedKeep = {
      ...anthropicBody,
      auth: { api_key: toRedactedSecretValue(anthropicBody.auth.api_key) },
      models: [
        model,
        {
          model_id: 'claude-opus-4',
          name: 'claude-opus-4',
          properties: model.properties,
        },
      ],
    };
    const update = await settingsRouter.request('/model-providers', putInit(redactedKeep));
    expect(update.status).toBe(200);
    const updateBody = (await update.json()) as {
      data: { auth: { api_key: string }; models: unknown[] };
    };
    expect(updateBody.data.auth.api_key).toBe(toRedactedSecretValue(anthropicBody.auth.api_key));
    expect(updateBody.data.models).toHaveLength(2);

    const stored = await modelProviderStore.getProvider({ tenant_id: TENANT_ID, name: 'anthropic' });
    expect(stored?.manifest.auth.api_key).toBe('sk-ant-secret');
  });

  it('PUT with a real api_key rotates the stored secret', async () => {
    const { settingsRouter, modelProviderStore } = await createRouters();
    expect((await settingsRouter.request('/model-providers', putInit(anthropicBody))).status).toBe(200);

    const rotatedKey = 'sk-ant-rotated-key';
    const rotated = { ...anthropicBody, auth: { api_key: rotatedKey } };
    const update = await settingsRouter.request('/model-providers', putInit(rotated));
    expect(update.status).toBe(200);
    expect((await update.json()) as { data: { auth: { api_key: string } } }).toEqual({
      data: withRedactedApiKey({ ...anthropicProvider, auth: { api_key: rotatedKey } }),
    });

    const stored = await modelProviderStore.getProvider({ tenant_id: TENANT_ID, name: 'anthropic' });
    expect(stored?.manifest.auth.api_key).toBe(rotatedKey);
  });
});

describe('catalog presets are configurable', () => {
  // A preset is copied into a PUT body with an api_key added, so every catalog type must parse.
  // `custom` is appended by the catalog route, not ModelCatalog — only well-known presets appear here.
  it.each(ModelCatalog.load().list())('PUT accepts the $type preset', async preset => {
    const { settingsRouter } = await createRouters();
    // `logo` is catalog-only metadata and a well-known provider takes its name from `type`; the rest
    // copies straight into a PUT body.
    const { logo, ...presetFields } = preset;
    const body = {
      ...presetFields,
      auth: { api_key: `sk-${preset.type}` },
    };
    expect(logo === undefined || typeof logo === 'string').toBe(true);
    const response = await settingsRouter.request('/model-providers', putInit(body));
    expect(response.status).toBe(200);
    const json = (await response.json()) as { data: { auth: { api_key: string } } };
    expect(json.data.auth.api_key).toBe(toRedactedSecretValue(`sk-${preset.type}`));
  });
});
