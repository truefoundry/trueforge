import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ModelCatalog } from './ModelCatalog';
import { ModelCatalogFileSchema, NameSchema, ProviderManifestSchema } from './schemas';

const model = (overrides: Partial<{ model_id: string; name: string }> = {}) => ({
  model_id: 'gpt-5.6-sol',
  name: 'gpt-5-6-sol',
  properties: { context_length: 400000, max_output_tokens: 32768, reasoning_efforts: ['low', 'high'] },
  ...overrides,
});

describe('NameSchema', () => {
  it('accepts slugs with dots, dashes and underscores', () => {
    for (const name of ['openai', 'gpt-5-6-sol', 'claude.sonnet_4-6', 'a', '0x1']) {
      assert.equal(NameSchema.safeParse(name).success, true, name);
    }
  });

  it('rejects uppercase, slashes, spaces, and edge separators', () => {
    for (const name of ['OpenAI', 'openai/gpt', 'gpt 5', '-gpt', 'gpt-', '', 'a'.repeat(65)]) {
      assert.equal(NameSchema.safeParse(name).success, false, name);
    }
  });
});

describe('ModelCatalogFileSchema', () => {
  it('rejects custom providers in the catalog', () => {
    const result = ModelCatalogFileSchema.safeParse({
      providers: [{ type: 'custom', name: 'mine', models: [model()] }],
    });
    assert.equal(result.success, false);
  });

  it('rejects duplicate provider names and duplicate models within a provider', () => {
    const duplicateProviders = ModelCatalogFileSchema.safeParse({
      providers: [
        { type: 'openai', name: 'openai', models: [model()] },
        { type: 'anthropic', name: 'openai', models: [model()] },
      ],
    });
    assert.equal(duplicateProviders.success, false);

    const duplicateModelIds = ModelCatalogFileSchema.safeParse({
      providers: [{ type: 'openai', name: 'openai', models: [model({ name: 'a' }), model({ name: 'b' })] }],
    });
    assert.equal(duplicateModelIds.success, false);
  });
});

describe('ProviderManifestSchema', () => {
  const base = { base_url: 'https://llm.example.com/v1', auth: { api_key: 'sk-test' }, models: [model()] };

  it('requires a valid base_url for every provider type', () => {
    for (const type of ['openai', 'anthropic', 'custom']) {
      assert.equal(ProviderManifestSchema.safeParse({ type, ...base }).success, true, type);
      const { base_url: _, ...withoutBaseUrl } = base;
      assert.equal(ProviderManifestSchema.safeParse({ type, ...withoutBaseUrl }).success, false, type);
    }
    assert.equal(ProviderManifestSchema.safeParse({ type: 'openai', ...base, base_url: 'not a url' }).success, false);
  });

  it('rejects empty api_key and empty model lists', () => {
    assert.equal(ProviderManifestSchema.safeParse({ ...base, type: 'openai', auth: { api_key: '' } }).success, false);
    assert.equal(ProviderManifestSchema.safeParse({ ...base, type: 'openai', models: [] }).success, false);
  });
});

describe('ModelCatalog', () => {
  it('loads the shipped default from REGISTRY_DIR', () => {
    // .env.test points REGISTRY_DIR at registry-example, which ships model-catalog.yaml.
    const catalog = ModelCatalog.load();
    const providers = catalog.list();
    assert.ok(providers.length >= 1);
    assert.ok(providers.every(provider => provider.models.length >= 1));
  });
});
