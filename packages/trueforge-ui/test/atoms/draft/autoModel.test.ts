import { describe, expect, it } from 'vitest';

import { autoCandidateNames, removedAutoCandidates, syncedAutoModel } from '@/atoms/draft/autoModel.js';
import type { ModelSelection } from '@/server/types.js';

function model({ name, enabled, supported = true }: { name: string; enabled: boolean; supported?: boolean }) {
  const selection: ModelSelection = {
    id: name,
    name,
    provider: { name: 'Account' },
    properties: {
      autoRouting: supported
        ? { supported: true, enabled, categories: ['answer'] }
        : { supported: false, unsupportedReason: 'Not mapped.' },
    },
  };
  return selection;
}

const models = [
  model({ name: 'a/one', enabled: true }),
  model({ name: 'a/two', enabled: true }),
  model({ name: 'a/three', enabled: true }),
  model({ name: 'a/four', enabled: true }),
  model({ name: 'a/five', enabled: false }),
  model({ name: 'a/six', enabled: true, supported: false }),
];

describe('autoCandidateNames', () => {
  it('uses the spec candidates when it names any', () => {
    expect(autoCandidateNames({ model: { type: 'auto', candidateModels: ['a/five'] }, models })).toEqual(['a/five']);
  });

  it('falls back to the supported models in the workspace Auto list', () => {
    expect(autoCandidateNames({ model: { type: 'auto', candidateModels: [] }, models })).toEqual([
      'a/one',
      'a/two',
      'a/three',
      'a/four',
    ]);
  });
});

describe('removedAutoCandidates', () => {
  it('returns the saved names the workspace no longer lists', () => {
    expect(removedAutoCandidates({ candidateModels: ['a/one', 'gone/model'], models })).toEqual(['gone/model']);
  });

  it('reports a saved model that settings do not enable for Auto', () => {
    expect(removedAutoCandidates({ candidateModels: ['a/one', 'a/five'], models })).toEqual(['a/five']);
  });

  it('reports a saved model that no longer supports Auto', () => {
    expect(removedAutoCandidates({ candidateModels: ['a/one', 'a/six'], models })).toEqual(['a/six']);
  });

  it('reports nothing while the workspace list is empty', () => {
    expect(removedAutoCandidates({ candidateModels: ['a/one'], models: [] })).toEqual([]);
  });
});

describe('syncedAutoModel', () => {
  it('drops the removed candidates', () => {
    const candidateModels = ['a/one', 'a/two', 'a/three', 'a/four'];

    expect(
      syncedAutoModel({
        model: { type: 'auto', candidateModels: [...candidateModels, 'a/five', 'gone/model'] },
        models,
      }),
    ).toEqual({
      type: 'auto',
      candidateModels,
    });
  });

  it('falls back to the workspace Auto models when too few candidates remain', () => {
    expect(
      syncedAutoModel({ model: { type: 'auto', candidateModels: ['a/one', 'a/two', 'gone/model'] }, models }),
    ).toEqual({ type: 'auto', candidateModels: [] });
  });
});
