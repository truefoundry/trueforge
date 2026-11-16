import { mapEnabledModels } from '../../../src/truefoundry/mapEnabledModels';

describe('mapEnabledModels', () => {
  it('still lists a model whose routing metadata has an unexpected shape', () => {
    const models = mapEnabledModels({
      integrations: [
        {
          name: 'model-a',
          manifest: { model_types: ['chat'] },
          providerAccount: { name: 'acct' },
          metadata: {
            external_ids: 'not-an-object',
            public_cost: 5,
            costs: [{ input_cost_per_token: 'free' }],
            modalities: null,
          },
        },
      ],
    });
    expect(models).toEqual([expect.objectContaining({ accountName: 'acct', modelName: 'model-a' })]);
  });
});
