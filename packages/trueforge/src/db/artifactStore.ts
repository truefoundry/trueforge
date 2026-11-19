import type { Subject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import type { ArtifactKind, ArtifactVersionStatus } from '../schemas/artifact';

export interface ArtifactRecord {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  kind: ArtifactKind;
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
  content_type: string;
  /** Object-store key. */
  storage_key: string;
  sha256: string;
}

export interface ArtifactVersionRecord {
  artifact_id: string;
  version: number;
  status: ArtifactVersionStatus;
  entrypoint: string;
  total_bytes: number;
  created_by_subject: Subject;
  created_by_session_id: string;
  created_by_turn_id: string | null;
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
  kind: ArtifactKind;
  created_by_subject: Subject;
  created_by_session_id: string;
}

export interface GetArtifactInput {
  tenant_id: string;
  slug: string;
}

export interface ListArtifactsInput {
  tenant_id: string;
  created_by_session_id?: string;
  kind?: ArtifactKind;
  limit: number | undefined;
  page_token: string | undefined;
}

export interface UpdateArtifactInput {
  tenant_id: string;
  slug: string;
  title: string;
}

export type DeleteArtifactInput = GetArtifactInput;

export interface CreateArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  entrypoint: string;
  files: ArtifactFileRecord[];
  created_by_subject: Subject;
  created_by_session_id: string;
  created_by_turn_id: string | null;
}

export interface ArtifactVersionKey {
  tenant_id: string;
  artifact_id: string;
  version: number;
}

export interface ListArtifactVersionsInput {
  tenant_id: string;
  artifact_id: string;
}

export interface CommitArtifactVersionInput extends ArtifactVersionKey {
  /** Kind of the committed version; becomes the artifact's kind. */
  kind: ArtifactKind;
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
  /** Inserts with `latest_version = 0`. Throws `ArtifactSlugConflictError` on a taken slug. */
  createArtifact(input: CreateArtifactInput, transaction?: TTransaction): Promise<ArtifactRecord>;
  getArtifact(input: GetArtifactInput, transaction?: TTransaction): Promise<ArtifactRecord | undefined>;
  /** Most recently updated first. */
  listArtifacts(
    input: ListArtifactsInput,
    transaction?: TTransaction,
  ): Promise<{ data: ArtifactRecord[]; pagination: TokenPagination }>;
  updateArtifact(input: UpdateArtifactInput, transaction?: TTransaction): Promise<ArtifactRecord | undefined>;
  /** Hard-deletes the artifact with its versions and files; returns the deleted id. */
  deleteArtifact(input: DeleteArtifactInput, transaction?: TTransaction): Promise<string | undefined>;
  /**
   * Allocates the next version number and inserts it as `pending` with its files.
   * Undefined when the artifact does not exist in the tenant.
   */
  createVersion(
    input: CreateArtifactVersionInput,
    transaction?: TTransaction,
  ): Promise<ArtifactVersionWithFiles | undefined>;
  getVersion(input: ArtifactVersionKey, transaction?: TTransaction): Promise<ArtifactVersionWithFiles | undefined>;
  /** Newest first, without files. */
  listVersions(input: ListArtifactVersionsInput, transaction?: TTransaction): Promise<ArtifactVersionRecord[]>;
  /**
   * Flips a `pending` version to `committed` and advances `latest_version` (never backwards).
   * Undefined when no pending version matched.
   */
  commitVersion(input: CommitArtifactVersionInput, transaction?: TTransaction): Promise<ArtifactRecord | undefined>;
  /** Flips a `pending` version to `failed`. Undefined when no pending version matched. */
  failVersion(input: ArtifactVersionKey, transaction?: TTransaction): Promise<ArtifactVersionRecord | undefined>;
}
