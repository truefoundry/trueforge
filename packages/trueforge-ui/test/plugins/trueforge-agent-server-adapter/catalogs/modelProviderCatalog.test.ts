import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import assert from 'node:assert/strict';
import { describe, it } from 'vitest';

import {
  toHarnessModelEntry,
  toHarnessModelProvider,
  toUiCatalogModelProviderEntry,
  toUiModelEntry,
  toUiModelProvider,
} from '@/plugins/trueforge-agent-server-adapter/catalogs/modelProviderCatalog.js';

describe('modelProviderCatalog mappers', () => {
  it('round-trips harness model entries through the UI shape', () => {
    const harness = {
      modelId: 'gpt-5.6-sol',
      name: 'gpt-5-6-sol',
      properties: {
        contextLength: 400000,
        maxOutputTokens: 32768,
        reasoningEfforts: ['low', 'medium', 'high'] as TrueForgeApi.ReasoningEffort[],
      },
    };

    assert.deepEqual(toUiModelEntry(harness), {
      id: 'gpt-5.6-sol',
      name: 'gpt-5-6-sol',
      properties: harness.properties,
    });
    assert.deepEqual(toHarnessModelEntry(toUiModelEntry(harness)), harness);
  });

  it('uses empty properties when the UI custom form omits them', () => {
    assert.deepEqual(toHarnessModelEntry({ id: 'llama3', name: 'llama3' }), {
      modelId: 'llama3',
      name: 'llama3',
      properties: {},
    });
  });

  it('names a well-known provider after its type and strips auth from the list card', () => {
    const harness = {
      type: 'openai' as const,
      auth: { apiKey: 'sk-secret' },
      models: [
        {
          modelId: 'gpt-5.6-sol',
          name: 'gpt-5-6-sol',
          properties: { contextLength: 400000, maxOutputTokens: 32768 },
        },
      ],
    };

    assert.deepEqual(toUiModelProvider({ name: 'openai', manifest: harness }), {
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

  // The stored name is the UI id, so getting this wrong points edits at the wrong row.
  it('keeps a custom provider under the name it was given', () => {
    assert.deepEqual(
      toUiModelProvider({
        name: 'local-llama',
        manifest: {
          type: 'custom' as const,
          name: 'local-llama',
          baseUrl: 'http://127.0.0.1:11434/v1',
          auth: { apiKey: 'sk-local' },
          models: [{ modelId: 'llama3', name: 'llama3', properties: {} }],
        },
      }),
      {
        id: 'local-llama',
        type: 'custom',
        name: 'local-llama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: [{ id: 'llama3', name: 'llama3', properties: {} }],
      },
    );
  });

  it('maps catalog presets and names them after their type', () => {
    assert.deepEqual(
      toUiCatalogModelProviderEntry({
        type: 'anthropic',
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
            properties: {},
          },
        ],
      },
    );

    assert.deepEqual(
      toHarnessModelProvider({
        type: 'custom',
        name: 'local-llama',
        apiKey: '',
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: [{ id: 'llama3', name: 'llama3' }],
      }),
      {
        type: 'custom',
        name: 'local-llama',
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: [
          {
            modelId: 'llama3',
            name: 'llama3',
            properties: {},
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
    const types = [...Object.values(TrueForgeApi.CatalogWellKnownModelProviderType), 'custom'];
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
