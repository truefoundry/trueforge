import type { Subject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';

export type ArtifactVersionStatus = 'pending' | 'committed' | 'failed';

export interface ArtifactRecord {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  /** Highest committed version; 0 until the first commit. */
  latest_version: number;
  created_by_subject: Subject;
  created_by_session_id: string;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface ArtifactFileRecord {
  /** Relative path within the version. */
  path: string;
  size_bytes: number;
  storage_key: string;
  sha256: string;
  /** ISO-8601 UTC instant. */
  created_at: string;
}

export interface ArtifactVersionRecord {
  artifact_id: string;
  version: number;
  status: ArtifactVersionStatus;
  entrypoint: string;
  created_by_turn_id: string;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface ArtifactVersionWithFiles extends ArtifactVersionRecord {
  files: ArtifactFileRecord[];
}

export interface CreateArtifactInput {
  tenant_id: string;
  slug: string;
  title: string;
  created_by_subject: Subject;
  created_by_session_id: string;
}

export interface GetArtifactInput {
  tenant_id: string;
  slug: string;
}

export interface ListArtifactsInput {
  tenant_id: string;
  limit: number;
  page_token: string | undefined;
}

export interface CreateArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  entrypoint: string;
  created_by_turn_id: string;
}

export interface ArtifactVersionKey {
  tenant_id: string;
  artifact_id: string;
  version: number;
}

export interface CommitArtifactVersionInput extends ArtifactVersionKey {
  /** `created_at` is set by the store at commit. */
  files: Omit<ArtifactFileRecord, 'created_at'>[];
}

/** Unique `(tenant_id, slug)` violation. */
export class ArtifactSlugConflictError extends Error {
  readonly tenant_id: string;
  readonly slug: string;

  constructor({ tenant_id, slug }: { tenant_id: string; slug: string }, options?: ErrorOptions) {
    super(`Artifact with slug ${slug} already exists`, options);
    this.name = 'ArtifactSlugConflictError';
    this.tenant_id = tenant_id;
    this.slug = slug;
  }
}

export interface IArtifactStore<TTransaction = never> {
  /** Throws `ArtifactSlugConflictError` when the slug is taken in the tenant. */
  createArtifact(input: CreateArtifactInput, transaction?: TTransaction): Promise<ArtifactRecord>;
  getArtifact(input: GetArtifactInput, transaction?: TTransaction): Promise<ArtifactRecord | undefined>;
  /** Newest first. */
  listArtifacts(
    input: ListArtifactsInput,
    transaction?: TTransaction,
  ): Promise<{ data: ArtifactRecord[]; pagination: TokenPagination }>;
  /**
   * Inserts the next version as `pending`. Storage keys depend on the version number, so files
   * are recorded at commit. Undefined when the artifact is not in the tenant.
   */
  createVersion(
    input: CreateArtifactVersionInput,
    transaction?: TTransaction,
  ): Promise<ArtifactVersionRecord | undefined>;
  /**
   * Records the uploaded files, marks a `pending` version `committed`, and advances
   * `latest_version` (never backwards). Undefined when no pending version matched.
   */
  commitVersion(input: CommitArtifactVersionInput, transaction?: TTransaction): Promise<ArtifactRecord | undefined>;
  /** Marks a `pending` version `failed`. False when no pending version matched. */
  failVersion(input: ArtifactVersionKey, transaction?: TTransaction): Promise<boolean>;
  getVersion(input: ArtifactVersionKey, transaction?: TTransaction): Promise<ArtifactVersionWithFiles | undefined>;
}
