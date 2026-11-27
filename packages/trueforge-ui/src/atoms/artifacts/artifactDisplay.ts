import type { SandboxFilePreviewTarget } from '../../filePreview/FilePreviewContext.js';
import { fileExtension, inlinePreviewKind } from '../../filePreview/readFilePreview.js';
import type { Artifact, ArtifactServer } from '../../server/types.js';

/** Preview cache identity; `updatedAt` advances on every new version, so stale bytes are not reused. */
export function artifactPreviewKey({ id, updatedAt }: Pick<Artifact, 'id' | 'updatedAt'>): string {
  return `${id}@${updatedAt}`;
}

/** Shared by the Artifacts page and the session card so both open the same preview. */
export function artifactPreviewTarget({
  artifact,
  artifactServer,
}: {
  artifact: Artifact;
  artifactServer: ArtifactServer;
}): SandboxFilePreviewTarget {
  return {
    name: artifact.name,
    // The list carries no entry file path; the read route picks it and the blob type drives rendering.
    path: artifact.name,
    turnId: artifactPreviewKey(artifact),
    load: () => artifactServer.readArtifactFile({ id: artifact.id }),
  };
}

const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v']);
const AUDIO_EXT = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac']);

export type ArtifactType = { label: string; icon: string };

const FILE_TYPE: ArtifactType = { label: 'File', icon: 'file' };

/** Short type label and icon for an artifact row, derived from the file name extension. */
export function artifactType({ name }: Pick<Artifact, 'name'>): ArtifactType {
  const kind = inlinePreviewKind({ name, path: name });
  if (kind === 'image') return { label: 'Image', icon: 'image' };
  if (kind === 'html') return { label: 'Html', icon: 'file-code' };
  if (kind === 'pdf') return { label: 'Pdf', icon: 'file-text' };
  const extension = fileExtension(name);
  if (VIDEO_EXT.has(extension)) return { label: 'Video', icon: 'file-video' };
  if (AUDIO_EXT.has(extension)) return { label: 'Audio', icon: 'file-audio' };
  return FILE_TYPE;
}
