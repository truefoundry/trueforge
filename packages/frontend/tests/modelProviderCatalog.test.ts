import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TrueForgeApi } from 'trueforge-sdk';
import {
  toHarnessModelEntry,
  toHarnessModelProvider,
  toUiCatalogEntry,
  toUiModelEntry,
  toUiModelProvider,
} from '../src/modelProviderCatalog';

describe('modelProviderCatalog mappers', () => {
  it('round-trips harness model entries through the UI shape', () => {
    const harness = {
      modelId: 'gpt-5.6-sol',
      name: 'gpt-5-6-sol',
      properties: {
        contextLength: 400000,
        maxOutputTokens: 32768,
        reasoningEfforts: ['low', 'medium', 'high'],
      },
    };

    assert.deepEqual(toUiModelEntry(harness), {
      id: 'gpt-5.6-sol',
      name: 'gpt-5-6-sol',
      properties: harness.properties,
    });
    assert.deepEqual(toHarnessModelEntry(toUiModelEntry(harness)), harness);
  });

  it('fills default properties when the UI custom form omits them', () => {
    assert.deepEqual(toHarnessModelEntry({ id: 'llama3', name: 'llama3' }), {
      modelId: 'llama3',
      name: 'llama3',
      properties: {
        contextLength: 128_000,
        maxOutputTokens: 16_384,
      },
    });
  });

  it('uses provider name as the UI id and strips auth from the list card', () => {
    const harness = {
      type: 'openai' as const,
      name: 'openai',
      auth: { apiKey: 'sk-secret' },
      models: [
        {
          modelId: 'gpt-5.6-sol',
          name: 'gpt-5-6-sol',
          properties: { contextLength: 400000, maxOutputTokens: 32768 },
        },
      ],
    };

    assert.deepEqual(toUiModelProvider(harness), {
      id: 'openai',
      type: 'openai',
      name: 'openai',
      models: [
        {
          id: 'gpt-5.6-sol',
          name: 'gpt-5-6-sol',
          properties: { contextLength: 400000, maxOutputTokens: 32768 },
        },
      ],
    });
  });

  it('maps catalog presets without inventing custom providers', () => {
    assert.deepEqual(
      toUiCatalogEntry({
        type: 'anthropic',
        name: 'anthropic',
        models: [
          {
            modelId: 'claude-sonnet-4-6',
            name: 'claude-sonnet-4-6',
            properties: { contextLength: 200000, maxOutputTokens: 32768 },
          },
        ],
      }),
      {
        type: 'anthropic',
        name: 'anthropic',
        models: [
          {
            id: 'claude-sonnet-4-6',
            name: 'claude-sonnet-4-6',
            properties: { contextLength: 200000, maxOutputTokens: 32768 },
          },
        ],
      },
    );
  });

  it('builds discriminated harness upsert bodies from UI create/update requests', () => {
    assert.deepEqual(
      toHarnessModelProvider({
        type: 'openai',
        name: 'openai',
        apiKey: 'sk-test',
        models: [
          {
            id: 'gpt-5.6-sol',
            name: 'gpt-5-6-sol',
            properties: { contextLength: 400000, maxOutputTokens: 32768 },
          },
        ],
      }),
      // No name: a well-known provider is named after its type by the API.
      {
        type: 'openai',
        auth: { apiKey: 'sk-test' },
        models: [
          {
            modelId: 'gpt-5.6-sol',
            name: 'gpt-5-6-sol',
            properties: { contextLength: 400000, maxOutputTokens: 32768 },
          },
        ],
      },
    );

    assert.deepEqual(
      toHarnessModelProvider({
        type: 'custom',
        name: 'local-llama',
        apiKey: 'sk-local',
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: [{ id: 'llama3', name: 'llama3' }],
      }),
      {
        type: 'custom',
        name: 'local-llama',
        auth: { apiKey: 'sk-local' },
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: [
          {
            modelId: 'llama3',
            name: 'llama3',
            properties: { contextLength: 128_000, maxOutputTokens: 16_384 },
          },
        ],
      },
    );
  });

  it('rejects custom providers without a base URL', () => {
    assert.throws(
      () =>
        toHarnessModelProvider({
          type: 'custom',
          name: 'broken',
          apiKey: 'sk',
          models: [{ id: 'm', name: 'm' }],
        }),
      /base URL/i,
    );
  });

  // Catalog presets are copied straight into this form, so a type the API accepts but this mapper
  // does not is a preset the user cannot save.
  it('builds a body for every provider type the API accepts', () => {
    const types = [...Object.values(TrueForgeApi.CatalogProviderType), 'custom'];
    for (const type of types) {
      const body = toHarnessModelProvider({
        type,
        name: type,
        apiKey: 'sk',
        baseUrl: 'https://example.com/v1',
        models: [{ id: 'm', name: 'm' }],
      });
      assert.equal(body.type, type);
    }
  });
});
