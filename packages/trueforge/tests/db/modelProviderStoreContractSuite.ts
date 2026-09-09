/**
 * Backend-agnostic behavioural contract for IModelProviderStore.
 * Runs under jest against a fresh store per test (see backend test files).
 */
import { ModelProviderNameConflictError, type IModelProviderStore } from '../../src/db/modelProviderStore';
import type { ModelProviderManifest } from '../../src/schemas/modelProvider';

const TENANT = 'default';

/** The API derives the row's name from the document; these fixtures pass it explicitly. */
const anthropic = {
  type: 'anthropic',
  base_url: 'https://api.anthropic.com/v1',
  auth: { api_key: 'sk-ant-test' },
  models: [
    {
      model_id: 'claude-sonnet-4-6',
      name: 'claude-sonnet-4-6',
      properties: { context_length: 200000, max_output_tokens: 32768, reasoning_efforts: ['low', 'high'] },
    },
  ],
} satisfies ModelProviderManifest;

const openai = {
  type: 'openai',
  base_url: 'https://api.openai.com/v1',
  auth: { api_key: 'sk-oai-test' },
  models: [
    { model_id: 'gpt-5.6-sol', name: 'gpt-5-6-sol', properties: { context_length: 400000, max_output_tokens: 32768 } },
  ],
} satisfies ModelProviderManifest;

const custom = {
  type: 'custom',
  name: 'internal',
  base_url: 'https://llm.internal.example.com/v1',
  auth: { api_key: 'sk-custom' },
  models: anthropic.models,
} satisfies ModelProviderManifest;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function runModelProviderStoreContractSuite(getStore: () => IModelProviderStore): void {
  it('upsert creates a provider and round-trips the document', async () => {
    const store = getStore();
    const created = await store.upsertProvider({ tenant_id: TENANT, name: 'anthropic', manifest: anthropic });

    expect(created.tenant_id).toBe(TENANT);
    expect(created.name).toBe('anthropic');
    expect(created.manifest).toEqual(anthropic);
    expect(created.created_at).toMatch(ISO_UTC);
    expect(created.updated_at).toBe(created.created_at);

    const fetched = await store.getProvider({ tenant_id: TENANT, name: 'anthropic' });
    expect(fetched).toEqual(created);
  });

  it('createProvider inserts and throws ModelProviderNameConflictError on name clash', async () => {
    const store = getStore();
    const created = await store.createProvider({ tenant_id: TENANT, name: 'anthropic', manifest: anthropic });
    expect(created.manifest).toEqual(anthropic);

    await expect(
      store.createProvider({ tenant_id: TENANT, name: 'anthropic', manifest: anthropic }),
    ).rejects.toBeInstanceOf(ModelProviderNameConflictError);
  });

  it('getProvider returns undefined for unknown providers', async () => {
    const store = getStore();
    expect(await store.getProvider({ tenant_id: TENANT, name: 'missing' })).toBeUndefined();
  });

  it('upsert replaces the whole document and preserves created_at', async () => {
    const store = getStore();
    const created = await store.upsertProvider({ tenant_id: TENANT, name: 'anthropic', manifest: anthropic });

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
    const updated = await store.upsertProvider({ tenant_id: TENANT, name: 'anthropic', manifest: replacement });

    expect(updated.manifest).toEqual(replacement);
    expect(updated.created_at).toBe(created.created_at);
    expect(Date.parse(updated.updated_at)).toBeGreaterThanOrEqual(Date.parse(created.updated_at));

    const providers = await store.listProviders({ tenant_id: TENANT });
    expect(providers).toEqual([updated]);
  });

  it('listProviders returns only the tenant, ordered by name', async () => {
    const store = getStore();
    await store.upsertProvider({ tenant_id: TENANT, name: 'openai', manifest: openai });
    await store.upsertProvider({ tenant_id: TENANT, name: 'anthropic', manifest: anthropic });
    await store.upsertProvider({ tenant_id: 'other-tenant', name: 'anthropic', manifest: anthropic });

    const providers = await store.listProviders({ tenant_id: TENANT });
    expect(providers.map(record => record.name)).toEqual(['anthropic', 'openai']);
    expect(providers.every(record => record.tenant_id === TENANT)).toBe(true);
  });

  it('stores custom providers with base_url', async () => {
    const store = getStore();
    const created = await store.upsertProvider({ tenant_id: TENANT, name: custom.name, manifest: custom });
    const { manifest } = created;
    if (manifest.type !== 'custom') {
      throw new Error(`expected custom manifest, got ${manifest.type}`);
    }
    expect(manifest.base_url).toBe('https://llm.internal.example.com/v1');
  });

  it('listModels flattens documents into fully qualified names', async () => {
    const store = getStore();
    await store.upsertProvider({ tenant_id: TENANT, name: 'anthropic', manifest: anthropic });
    await store.upsertProvider({ tenant_id: TENANT, name: 'openai', manifest: openai });
    await store.upsertProvider({ tenant_id: 'other-tenant', name: 'openai', manifest: openai });

    const models = await store.listModels({ tenant_id: TENANT });
    expect(models).toEqual([
      {
        name: 'anthropic/claude-sonnet-4-6',
        model_id: 'claude-sonnet-4-6',
        provider: { name: 'anthropic' },
        properties: { context_length: 200000, max_output_tokens: 32768, reasoning_efforts: ['low', 'high'] },
      },
      {
        name: 'openai/gpt-5-6-sol',
        model_id: 'gpt-5.6-sol',
        provider: { name: 'openai' },
        properties: { context_length: 400000, max_output_tokens: 32768 },
      },
    ]);
  });
}
