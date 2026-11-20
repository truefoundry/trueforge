import type { Subject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';

export interface ArtifactRecord {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  /** Highest version; 0 until the first version. */
  latest_version: number;
  created_by_subject: Subject;
  created_by_session_id: string;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface ArtifactVersionRecord {
  artifact_id: string;
  version: number;
  /** Object-store prefix holding the version's files. */
  storage_prefix: string;
  total_bytes: number;
  /** ISO-8601 UTC instant. */
  created_at: string;
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
  created_by_subject_id: string;
  limit: number;
  page_token: string | undefined;
}

export interface CreateArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  storage_prefix: string;
  total_bytes: number;
}

export interface GetArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  version: number;
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
  /** Most recently updated first. */
  listArtifacts(
    input: ListArtifactsInput,
    transaction?: TTransaction,
  ): Promise<{ data: ArtifactRecord[]; pagination: TokenPagination }>;
  /**
   * Inserts the next version for files already uploaded under `storage_prefix` and advances
   * `latest_version`. Undefined when the artifact is not in the tenant.
   */
  createVersion(
    input: CreateArtifactVersionInput,
    transaction?: TTransaction,
  ): Promise<ArtifactVersionRecord | undefined>;
  getVersion(input: GetArtifactVersionInput, transaction?: TTransaction): Promise<ArtifactVersionRecord | undefined>;
}
