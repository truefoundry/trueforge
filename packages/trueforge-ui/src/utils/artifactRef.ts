import type { Artifact } from '../server/types.js';

// Ids are lowercase ULIDs with no `-`, and the slug collapses runs of `-`, so `--` only appears as the separator.
const REF_SEPARATOR = '--';

/** URL segment `name-with-hyphens--{id}`. */
export function artifactRef({ name, id }: Pick<Artifact, 'name' | 'id'>): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? id : `${slug}${REF_SEPARATOR}${id}`;
}

/** Reads only the id after the last `--`. The name part is display-only and is never parsed. */
export function artifactIdFromRef(ref: string): string {
  const at = ref.lastIndexOf(REF_SEPARATOR);
  return at < 0 ? ref : ref.slice(at + REF_SEPARATOR.length);
}
