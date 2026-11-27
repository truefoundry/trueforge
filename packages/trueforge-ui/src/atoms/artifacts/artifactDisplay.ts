import type { Artifact } from '../../server/types.js';

export const SHARE_UNAVAILABLE_REASON = 'Sharing artifacts is not available yet.';

/** Preview cache identity; `updatedAt` advances on every new version, so stale bytes are not reused. */
export function artifactPreviewKey({ id, updatedAt }: Pick<Artifact, 'id' | 'updatedAt'>): string {
  return `${id}@${updatedAt}`;
}
