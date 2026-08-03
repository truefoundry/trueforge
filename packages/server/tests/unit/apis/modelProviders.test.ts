import assert from 'node:assert/strict';
import { before, describe, it } from 'node:test';
import { createModelProvidersRouter } from '../../../src/apis/modelProviders';
import { createModelsRouter } from '../../../src/apis/models';
import { ModelCatalog } from '../../../src/catalog/ModelCatalog';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';

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

const redactedProvider = { ...putBody, auth: { api_key_set: true } };

function putInit(body: unknown): RequestInit {
  return {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

describe('model-providers and models routers', () => {
  let providersRouter: ReturnType<typeof createModelProvidersRouter>;
  let modelsRouter: ReturnType<typeof createModelsRouter>;

  before(async () => {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const modelProviderStore = new SqliteModelProviderStore(db);
    providersRouter = createModelProvidersRouter({ modelCatalog: ModelCatalog.load(), modelProviderStore });
    modelsRouter = createModelsRouter(modelProviderStore);
  });

  it('GET /catalog returns the shipped catalog verbatim', async () => {
    const response = await providersRouter.request('/catalog');
    assert.equal(response.status, 200);
    const body = (await response.json()) as { data: { type: string; name: string }[] };
    assert.deepEqual(
      body.data.map(provider => provider.name),
      ModelCatalog.load()
        .list()
        .map(provider => provider.name),
    );
    assert.ok(body.data.every(provider => provider.type !== 'custom'));
  });

  it('PUT upserts a provider and redacts the api key', async () => {
    const response = await providersRouter.request('/', putInit(putBody));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { data: redactedProvider });

    const list = await providersRouter.request('/');
    assert.equal(list.status, 200);
    assert.deepEqual(await list.json(), { data: [redactedProvider] });
  });

  it('PUT rejects invalid bodies at the Zod layer', async () => {
    const { base_url: _, ...withoutBaseUrl } = putBody;
    const missingBaseUrl = await providersRouter.request('/', putInit(withoutBaseUrl));
    assert.equal(missingBaseUrl.status, 400);

    const badName = await providersRouter.request('/', putInit({ ...putBody, name: 'Not A Slug' }));
    assert.equal(badName.status, 400);
  });

  it('GET /models returns the FQN read view', async () => {
    const response = await modelsRouter.request('/');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
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
