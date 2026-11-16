const SLUG = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,63}$/;
const RESERVED = new Set(['new', 'api', 'assets']);

export function normalizeSlugInput(slug: string): string {
  return slug.trim().toLowerCase();
}

export function isValidArtifactSlug(slug: string): boolean {
  return SLUG.test(slug) && !RESERVED.has(slug);
}

/** ASCII-fold, kebab-case, and append a random suffix. Empty titles become `artifact-<suffix>`. */
export function generateArtifactSlug(title: string): string {
  const folded = title
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');
  const base = folded.length >= 3 ? folded : 'artifact';
  const suffix = randomBase36(6);
  const slug = `${base}-${suffix}`.slice(0, 64).replace(/-+$/g, '');
  return isValidArtifactSlug(slug) ? slug : `artifact-${suffix}`;
}

function randomBase36(length: number): string {
  return Array.from({ length }, () => Math.floor(Math.random() * 36).toString(36)).join('');
}
