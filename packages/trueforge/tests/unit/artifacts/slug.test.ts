import { generateArtifactSlug, isValidArtifactSlug, normalizeSlugInput } from '../../../src/artifacts/slug';

describe('artifact slugs', () => {
  it('accepts a kebab slug and rejects reserved or malformed ones', () => {
    expect(isValidArtifactSlug('q3-report')).toBe(true);
    expect(isValidArtifactSlug(normalizeSlugInput('  Q3-Report  '))).toBe(true);
    expect(isValidArtifactSlug('ab')).toBe(false);
    expect(isValidArtifactSlug('-report')).toBe(false);
    expect(isValidArtifactSlug('report-')).toBe(false);
    expect(isValidArtifactSlug('a--b')).toBe(false);
    expect(isValidArtifactSlug('new')).toBe(false);
    expect(isValidArtifactSlug('api')).toBe(false);
    expect(isValidArtifactSlug('assets')).toBe(false);
  });

  it('builds a slug from a title', () => {
    const slug = generateArtifactSlug('Q3 Revenue — Café');
    expect(slug.startsWith('q3-revenue-cafe-')).toBe(true);
    expect(isValidArtifactSlug(slug)).toBe(true);
    expect(isValidArtifactSlug(generateArtifactSlug('!!'))).toBe(true);
  });
});
