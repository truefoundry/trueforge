export interface ArtifactPushLimits {
  max_files: number;
  max_total_bytes: number;
}

export interface ArtifactObject {
  key: string;
  size_bytes: number;
  sha256_b64: string;
}

/** Object storage the sandbox uploads to directly. */
export interface IObjectStore {
  /** PUT URL signed to the object's size and sha256; `headers` must be sent unchanged. */
  presignPut(object: ArtifactObject): Promise<{ url: string; headers: Record<string, string> }>;
  /** Every object whose key starts with `prefix`. */
  listObjects(input: { prefix: string }): Promise<Pick<ArtifactObject, 'key' | 'size_bytes'>[]>;
}

interface ArtifactFilesMetadata {
  entry_point: string;
  total_bytes: number;
  root_path: string;
}

/** Artifact records, already bound by the host to the session's tenant, user and agent. */
export interface ScopedArtifactStore {
  /** Error message when the artifact is missing or the user may not push to it; undefined when allowed. */
  checkPushAccess(input: { artifact_id: string }): Promise<string | undefined>;
  /** Validates the name and mints an id for a new artifact; nothing is stored. Throws on an invalid name. */
  newArtifactId(input: { name: string }): string;
  /** Creates the artifact with version 1 in one write. */
  createArtifactWithVersion(input: {
    id: string;
    name: string;
    files_metadata: ArtifactFilesMetadata;
  }): Promise<{ version: number }>;
  /** Undefined when the artifact no longer exists. */
  createVersion(input: {
    artifact_id: string;
    files_metadata: ArtifactFilesMetadata;
  }): Promise<{ version: number } | undefined>;
}

/** What `push_artifact` needs from the host for one turn. */
export interface IArtifactsProvider {
  tenantId: string;
  store: ScopedArtifactStore;
  objectStore: IObjectStore;
  limits: ArtifactPushLimits;
}
