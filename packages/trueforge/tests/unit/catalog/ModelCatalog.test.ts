import { ModelCatalog } from '../../../src/catalog/ModelCatalog';

describe('ModelCatalog OpenRouter sync', () => {
  it('replaces shipped OpenRouter presets with the cached OpenRouter catalog', async () => {
    const listOpenRouterModels = jest.fn(async () => [
      {
        model_id: 'anthropic/claude-sonnet-4.6',
        name: 'anthropic-claude-sonnet-4.6',
        properties: { context_length: 1_000_000, max_output_tokens: 128_000 },
      },
    ]);
    const catalog = ModelCatalog.load({ listOpenRouterModels });

    await catalog.sync();
    await catalog.sync();

    expect(listOpenRouterModels).toHaveBeenCalledTimes(1);
    expect(catalog.list().find(provider => provider.type === 'openrouter')?.models).toEqual([
      {
        model_id: 'anthropic/claude-sonnet-4.6',
        name: 'anthropic-claude-sonnet-4.6',
        properties: { context_length: 1_000_000, max_output_tokens: 128_000 },
      },
    ]);
  });

  it('retains shipped presets when the remote catalog is unavailable', async () => {
    const listOpenRouterModels = jest.fn(async () => {
      throw new Error('OpenRouter unavailable');
    });
    const catalog = ModelCatalog.load({ listOpenRouterModels });
    const shipped = catalog.list().find(provider => provider.type === 'openrouter')?.models;

    await catalog.sync();

    expect(catalog.list().find(provider => provider.type === 'openrouter')?.models).toEqual(shipped);
  });
});
