import type { Readable } from 'node:stream';

export type ArtifactStorageBackendName = 'local' | 's3';

/**
 * One version is a directory of files. `prefix` is the fully qualified location
 * stored on the version row; `path` is the bundle-relative file path.
 */
export interface ArtifactBlobStorage {
  readonly backend: ArtifactStorageBackendName;
  resolvePrefix(input: { key: string }): string;
  put(input: { prefix: string; path: string; body: Buffer; mediaType: string }): Promise<void>;
  get(input: { prefix: string; path: string }): Promise<Readable>;
  deletePrefix(input: { prefix: string }): Promise<void>;
}

/** Rejects absolute paths and `..` segments before they reach a backend. */
export function assertBundlePath(filePath: string): void {
  if (filePath.length === 0 || filePath.startsWith('/') || filePath.includes('\\') || filePath.includes('\0')) {
    throw new Error(`Invalid artifact path: ${filePath}`);
  }
  if (filePath.split('/').some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new Error(`Invalid artifact path: ${filePath}`);
  }
}
