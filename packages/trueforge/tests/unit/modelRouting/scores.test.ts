import { lookupScore } from '../../../src/modelRouting/scores';

const scores = {
  'model-a': { name: 'Model A', score: 40 },
  'model-a-low': { name: 'Model A', score: 10 },
  'model-a-medium': { name: 'Model A', score: 20 },
  'model-b-low': { name: 'Model B', score: 5 },
  'model-b-high': { name: 'Model B', score: 15 },
  'model-a-5-high': { name: 'Model A 5', score: 99 },
};

describe('lookupScore', () => {
  it.each([
    { case: 'the exact effort variant', slug: 'model-a', effort: 'medium', score: 20 },
    { case: 'the unlabelled slug when the effort has no variant', slug: 'model-a', effort: 'max', score: 40 },
    { case: 'the nearest effort, ties going higher', slug: 'model-b', effort: 'medium', score: 15 },
    { case: 'its own score, never a longer slug that starts with it', slug: 'model-a', effort: 'high', score: 40 },
    { case: 'nothing for an unknown slug', slug: 'model', effort: 'medium', score: undefined },
  ])('returns $case', ({ slug, effort, score }) => {
    expect(lookupScore({ slug, effort, scores })?.score).toBe(score);
  });
});
