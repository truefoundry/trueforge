import type { Artifact } from '../server/types.js';

/** URL segment `title-with-hyphens-{id}`; the id is everything after the last `-`. */
export function artifactRef({ title, id }: Pick<Artifact, 'title' | 'id'>): string {
  const name = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return name === '' ? id : `${name}-${id}`;
}

export function artifactIdFromRef(ref: string): string {
  return ref.slice(ref.lastIndexOf('-') + 1);
}
