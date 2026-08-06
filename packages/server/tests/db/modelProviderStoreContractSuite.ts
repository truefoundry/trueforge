/**
 * Backend-agnostic behavioural contract for IModelProviderStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import type { IModelProviderStore } from '../../src/db/modelProviderStore';
import type { ModelProvider } from '../../src/schemas/modelProvider';

const TENANT = 'default';

/** Each type pins its own `name`, so one fixture per provider. */
const anthropic = {
  type: 'anthropic',
  name: 'anthropic',
  base_url: 'https://api.anthropic.com/v1',
  auth: { api_key: 'sk-ant-test' },
  models: [
    {
      model_id: 'claude-sonnet-4-6',
      name: 'claude-sonnet-4-6',
      properties: { context_length: 200000, max_output_tokens: 32768, reasoning_efforts: ['low', 'high'] },
    },
  ],
} satisfies ModelProvider;

const openai = {
  type: 'openai',
  name: 'openai',
  base_url: 'https://api.openai.com/v1',
  auth: { api_key: 'sk-oai-test' },
  models: [
    { model_id: 'gpt-5.6-sol', name: 'gpt-5-6-sol', properties: { context_length: 400000, max_output_tokens: 32768 } },
  ],
} satisfies ModelProvider;

const custom = {
  type: 'custom',
  name: 'internal',
  base_url: 'https://llm.internal.example.com/v1',
  auth: { api_key: 'sk-custom' },
  models: anthropic.models,
} satisfies ModelProvider;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function runModelProviderStoreContractSuite(getStore: () => IModelProviderStore): void {
  it('upsert creates a provider and round-trips the document', async () => {
    const store = getStore();
    const created = await store.upsertProvider({ tenant_id: TENANT, manifest: anthropic });

    expect(created.tenant_id).toBe(TENANT);
    expect(created.name).toBe('anthropic');
    expect(created.manifest).toEqual(anthropic);
    expect(created.created_at).toMatch(ISO_UTC);
    expect(created.updated_at).toBe(created.created_at);

    const fetched = await store.getProvider({ tenant_id: TENANT, name: 'anthropic' });
    expect(fetched).toEqual(created);
  });

  it('getProvider returns undefined for unknown providers', async () => {
    const store = getStore();
    expect(await store.getProvider({ tenant_id: TENANT, name: 'missing' })).toBeUndefined();
  });

  it('upsert replaces the whole document and preserves created_at', async () => {
    const store = getStore();
    const created = await store.upsertProvider({ tenant_id: TENANT, manifest: anthropic });

    const replacement = {
      ...anthropic,
      auth: { api_key: 'sk-ant-rotated' },
      models: [
        {
          model_id: 'claude-opus-4-6',
          name: 'claude-opus-4-6',
          properties: { context_length: 200000, max_output_tokens: 65536 },
        },
      ],
    };
    const updated = await store.upsertProvider({ tenant_id: TENANT, manifest: replacement });

    expect(updated.manifest).toEqual(replacement);
    expect(updated.created_at).toBe(created.created_at);
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));

    const providers = await store.listProviders(TENANT);
    expect(providers).toEqual([updated]);
  });

  it('listProviders returns only the tenant, ordered by name', async () => {
    const store = getStore();
    await store.upsertProvider({ tenant_id: TENANT, manifest: openai });
    await store.upsertProvider({ tenant_id: TENANT, manifest: anthropic });
    await store.upsertProvider({ tenant_id: 'other-tenant', manifest: anthropic });

    const providers = await store.listProviders(TENANT);
    expect(providers.map(record => record.name)).toEqual(['anthropic', 'openai']);
    expect(providers.every(record => record.tenant_id === TENANT)).toBe(true);
  });

  it('stores custom providers with base_url', async () => {
    const store = getStore();
    const created = await store.upsertProvider({ tenant_id: TENANT, manifest: custom });
    expect(created.manifest.base_url).toBe('https://llm.internal.example.com/v1');
  });

  it('listModels flattens documents into fully qualified names', async () => {
    const store = getStore();
    await store.upsertProvider({ tenant_id: TENANT, manifest: anthropic });
    await store.upsertProvider({ tenant_id: TENANT, manifest: openai });
    await store.upsertProvider({ tenant_id: 'other-tenant', manifest: openai });

    const models = await store.listModels(TENANT);
    expect(models).toEqual([
      {
        name: 'anthropic/claude-sonnet-4-6',
        model_id: 'claude-sonnet-4-6',
        properties: { context_length: 200000, max_output_tokens: 32768, reasoning_efforts: ['low', 'high'] },
      },
      {
        name: 'openai/gpt-5-6-sol',
        model_id: 'gpt-5.6-sol',
        properties: { context_length: 400000, max_output_tokens: 32768 },
      },
    ]);
  });
}
