import { mapOpenRouterModels } from '../../../src/catalog/openRouterModelCatalog';
import { ModelProviderManifestSchema } from '../../../src/schemas/modelProvider';

describe('mapOpenRouterModels', () => {
  it('maps OpenRouter SDK models into valid, unique configured model entries', () => {
    const models = mapOpenRouterModels([
      {
        id: 'anthropic/claude-sonnet-4.6',
        contextLength: 1_000_000,
        topProvider: {
          isModerated: true,
          maxCompletionTokens: 128_000,
        },
        reasoning: {
          mandatory: false,
          supportedEfforts: ['max', 'high', 'medium', 'low'],
        },
      },
      {
        id: 'vendor/model:free',
        contextLength: null,
        topProvider: { isModerated: false },
      },
      {
        id: 'vendor/model-free',
        contextLength: null,
        topProvider: { isModerated: false },
      },
      {
        id: `vendor/${'very-long-model-name-'.repeat(5)}latest`,
        contextLength: null,
        topProvider: { isModerated: false },
      },
    ]);

    expect(models).toHaveLength(4);
    expect(models[0]).toEqual({
      model_id: 'anthropic/claude-sonnet-4.6',
      name: 'anthropic-claude-sonnet-4.6',
      properties: {
        context_length: 1_000_000,
        max_output_tokens: 128_000,
        reasoning_efforts: ['max', 'high', 'medium', 'low'],
      },
    });
    expect(new Set(models.map(model => model.name)).size).toBe(models.length);
    expect(models.every(model => model.name.length <= 64)).toBe(true);
    expect(
      ModelProviderManifestSchema.safeParse({
        type: 'openrouter',
        auth: { api_key: 'sk-test' },
        models,
      }).success,
    ).toBe(true);
  });
});
