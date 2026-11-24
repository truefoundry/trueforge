import type { Artifact } from '../../server/types.js';

export const NO_ENTRY_POINT_REASON = 'This artifact has no entry file to open.';

/** Preview cache identity; a new version must not reuse the previous bytes. */
export function artifactPreviewKey({ id, latestVersion }: Pick<Artifact, 'id' | 'latestVersion'>): string {
  return `${id}@v${String(latestVersion)}`;
}
