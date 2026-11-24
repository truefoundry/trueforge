import { fileExtension } from '../../filePreview/readFilePreview.js';
import type { Artifact } from '../../server/types.js';

const TYPE_LABELS: Record<string, string> = {
  html: 'HTML',
  htm: 'HTML',
  md: 'Markdown',
  markdown: 'Markdown',
  pdf: 'PDF',
  png: 'Image',
  jpg: 'Image',
  jpeg: 'Image',
  svg: 'Image',
  json: 'JSON',
};

export function artifactTypeLabel(entryPoint: string | null): string {
  if (entryPoint == null) return 'Unknown';
  const ext = fileExtension(entryPoint);
  return TYPE_LABELS[ext] ?? (ext === '' ? 'File' : ext.toUpperCase());
}

export const NO_ENTRY_POINT_REASON = 'This artifact has no entry file to open.';

/** Preview cache identity; a new version must not reuse the previous bytes. */
export function artifactPreviewKey({ id, latestVersion }: Pick<Artifact, 'id' | 'latestVersion'>): string {
  return `${id}@v${String(latestVersion)}`;
}
