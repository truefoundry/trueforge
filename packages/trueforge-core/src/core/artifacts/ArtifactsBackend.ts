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
  /** True when the object landed with the signed size and sha256. */
  verify(object: ArtifactObject): Promise<boolean>;
}

/** Artifact records, already bound by the host to the session's tenant, user and agent. */
export interface ScopedArtifactStore {
  /** Error message when the artifact is missing or the user may not push to it; undefined when allowed. */
  checkPushAccess(input: { artifact_id: string }): Promise<string | undefined>;
  createArtifact(input: { name: string }): Promise<{ id: string }>;
  /** Undefined when the artifact no longer exists. */
  createVersion(input: {
    artifact_id: string;
    files_metadata: { entry_point: string; total_bytes: number; root_path: string };
  }): Promise<{ version: number } | undefined>;
}

/** What `push_artifact` needs from the host for one turn. */
export interface ArtifactsBackend {
  tenantId: string;
  store: ScopedArtifactStore;
  objectStore: IObjectStore;
  limits: ArtifactPushLimits;
}
