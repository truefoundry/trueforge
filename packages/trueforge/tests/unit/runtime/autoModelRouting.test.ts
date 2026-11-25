import type { IModelProviderStore, ModelInfo } from '../../../src/db/modelProviderStore';
import { listAutoCandidateModels } from '../../../src/runtime/autoModelRouting';

function model(name: string): ModelInfo {
  return { name, model_id: name, provider: { name: 'acct' }, properties: {}, canonicalModel: undefined, cost: 1 };
}

const accessible = ['acct/a', 'acct/b', 'acct/c'].map(model);
const modelProviderStore = { listModels: () => Promise.resolve(accessible) } as unknown as IModelProviderStore;

function list(candidate_models: string[]) {
  return listAutoCandidateModels({
    tenant_id: 'default',
    modelProviderStore,
    autoModelRouting: { enabled: true, candidate_models },
  });
}

describe('listAutoCandidateModels', () => {
  it('keeps the candidate models the user has, ignoring ones they lack', async () => {
    const { candidateModels } = await list(['acct/b', 'acct/not-visible']);

    expect(candidateModels.map(m => m.name)).toEqual(['acct/b']);
  });

  it('keeps nothing for an empty candidate list, while still reporting the accessible models', async () => {
    const result = await list([]);

    expect(result.candidateModels).toEqual([]);
    expect(result.accessibleModels).toEqual(accessible);
  });
});
