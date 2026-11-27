import { AgentSpecSchema } from '../../src/agent-session/schemas/agentSpec';

const CANDIDATES = ['a/one', 'a/two', 'a/three', 'a/four'];

describe('AgentSpecSchema model', () => {
  it('accepts a fixed model with opaque non-empty identifiers including non-FQN shapes', () => {
    for (const name of ['gpt-4', 'provider/model', 'a/b/c']) {
      expect(AgentSpecSchema.parse({ model: { type: 'fixed', name } }).model).toEqual({ type: 'fixed', name });
    }
  });

  it('accepts fixed model params', () => {
    const model = { type: 'fixed', name: 'provider/model', params: { temperature: 0.2, custom: 1 } };
    expect(AgentSpecSchema.parse({ model }).model).toEqual(model);
  });

  it('rejects an empty fixed model name', () => {
    expect(AgentSpecSchema.safeParse({ model: { type: 'fixed', name: '' } }).success).toBe(false);
  });

  it('accepts an auto model with candidate models', () => {
    const model = { type: 'auto', candidate_models: CANDIDATES };
    expect(AgentSpecSchema.parse({ model }).model).toEqual(model);
  });

  it('accepts no candidates, which leaves the choice to the tenant', () => {
    expect(AgentSpecSchema.parse({ model: { type: 'auto', candidate_models: [] } }).model).toEqual({
      type: 'auto',
      candidate_models: [],
    });
  });

  it('accepts exactly the fewest and the most candidates', () => {
    expect(AgentSpecSchema.safeParse({ model: { type: 'auto', candidate_models: CANDIDATES } }).success).toBe(true);
    const most = Array.from({ length: 10 }, (_, index) => `a/model-${String(index)}`);
    expect(AgentSpecSchema.safeParse({ model: { type: 'auto', candidate_models: most } }).success).toBe(true);
  });

  it.each([
    ['missing candidates', { type: 'auto' }],
    ['too few candidates', { type: 'auto', candidate_models: CANDIDATES.slice(0, 3) }],
    ['a single candidate', { type: 'auto', candidate_models: CANDIDATES.slice(0, 1) }],
    [
      'too many candidates',
      { type: 'auto', candidate_models: Array.from({ length: 11 }, (_, i) => `a/model-${String(i)}`) },
    ],
    ['a candidate that is not account/model', { type: 'auto', candidate_models: [...CANDIDATES.slice(0, 3), 'one'] }],
    ['an empty candidate name', { type: 'auto', candidate_models: [...CANDIDATES.slice(0, 3), ''] }],
    ['duplicate candidates', { type: 'auto', candidate_models: [...CANDIDATES, CANDIDATES[0]] }],
    ['fixed-model fields', { type: 'auto', candidate_models: CANDIDATES, name: 'a/b' }],
    ['params', { type: 'auto', candidate_models: CANDIDATES, params: {} }],
  ])('rejects an auto model with %s', (_label, model) => {
    expect(AgentSpecSchema.safeParse({ model }).success).toBe(false);
  });

  it('rejects a model without a type, and auto-only fields on a fixed model', () => {
    expect(AgentSpecSchema.safeParse({ model: { name: 'provider/model' } }).success).toBe(false);
    expect(
      AgentSpecSchema.safeParse({ model: { type: 'fixed', name: 'a/b', candidate_models: ['a/b'] } }).success,
    ).toBe(false);
  });
});
