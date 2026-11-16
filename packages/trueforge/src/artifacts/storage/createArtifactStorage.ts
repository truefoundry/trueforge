import path from 'node:path';
import { getAppDataDir, type ServerConfiguration } from '../../config';
import type { ArtifactBlobStorage, ArtifactStorageBackendName } from './ArtifactBlobStorage';
import { LocalArtifactStorage } from './LocalArtifactStorage';
import { S3ArtifactStorage, type S3ArtifactStorageOptions } from './S3ArtifactStorage';

export interface ArtifactStorageRegistry {
  /** Backend used for newly published versions. */
  readonly write: ArtifactBlobStorage;
  get(backend: ArtifactStorageBackendName): ArtifactBlobStorage | undefined;
}

/**
 * Registers a backend for reads whenever its config is present, so versions written
 * before a switch from local disk to S3 stay readable.
 */
export function createArtifactStorage(config: ServerConfiguration): ArtifactStorageRegistry {
  const stores = new Map<ArtifactStorageBackendName, ArtifactBlobStorage>();
  stores.set('local', new LocalArtifactStorage(resolveLocalDirectory(config)));
  if (config.ARTIFACT_S3_BUCKET !== undefined) {
    const options: S3ArtifactStorageOptions = {
      bucket: config.ARTIFACT_S3_BUCKET,
      keyPrefix: config.ARTIFACT_S3_PREFIX,
      region: config.ARTIFACT_S3_REGION,
      endpoint: config.ARTIFACT_S3_ENDPOINT,
      forcePathStyle: config.ARTIFACT_S3_FORCE_PATH_STYLE,
    };
    stores.set('s3', new S3ArtifactStorage(options));
  }
  const write = stores.get(config.ARTIFACT_STORAGE_BACKEND);
  if (write === undefined) {
    throw new Error(`Artifact storage backend "${config.ARTIFACT_STORAGE_BACKEND}" is not configured`);
  }
  return {
    write,
    get(backend) {
      return stores.get(backend);
    },
  };
}

/** Distributed replicas must point at a shared directory; a per-host default would 404 across replicas. */
function resolveLocalDirectory(config: ServerConfiguration): string {
  if (config.ARTIFACT_STORAGE_LOCAL_DIR !== undefined) {
    return config.ARTIFACT_STORAGE_LOCAL_DIR;
  }
  if (config.STANDALONE) {
    return path.join(getAppDataDir(), 'artifacts');
  }
  if (config.ARTIFACT_STORAGE_BACKEND === 'local') {
    throw new Error(
      'ARTIFACT_STORAGE_LOCAL_DIR is required when ARTIFACT_STORAGE_BACKEND=local and STANDALONE is false. Set it to a directory shared by every replica.',
    );
  }
  // Local reads stay registered after a switch to S3; a missing directory only matters for old rows.
  return path.join(getAppDataDir(), 'artifacts');
}
