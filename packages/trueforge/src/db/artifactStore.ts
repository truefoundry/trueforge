/**
 * Published artifacts and their immutable versions.
 *
 * Transactions are route-owned: a store method never opens one. Creating a version
 * inserts the version row and its files on the same transaction the caller passes,
 * after the blobs are already in storage.
 */
import type { Subject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';

export type ArtifactEntryContentType = 'html' | 'markdown';
export type ArtifactStorageBackendName = 'local' | 's3';

export class ArtifactSlugConflictError extends Error {
  constructor(options?: { cause?: unknown }) {
    super('An artifact with this slug already exists');
    this.name = 'ArtifactSlugConflictError';
    if (options?.cause !== undefined) {
      this.cause = options.cause;
    }
  }
}

export interface ArtifactRecord {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  description: string | null;
  latest_version: number;
  created_by_subject: Subject;
  created_at: string;
  updated_at: string;
}

export interface ArtifactVersionRecord {
  id: string;
  tenant_id: string;
  artifact_id: string;
  version: number;
  entry_path: string;
  entry_content_type: ArtifactEntryContentType;
  file_count: number;
  total_size_bytes: number;
  manifest_sha256: string;
  session_id: string;
  turn_id: string;
  source_root: string;
  note: string | null;
  storage_backend: ArtifactStorageBackendName;
  storage_location: string;
  created_by_subject: Subject;
  created_at: string;
}

export interface ArtifactFileRecord {
  path: string;
  size_bytes: number;
  sha256: string;
  media_type: string;
}

export interface ListArtifactsInput {
  tenant_id: string;
  limit: number;
  page_token: string | undefined;
  slug: string | undefined;
  session_id: string | undefined;
  created_by_subject_id: string | undefined;
  query: string | undefined;
}

export interface ListArtifactsResult {
  data: ArtifactRecord[];
  pagination: TokenPagination;
}

export interface GetArtifactInput {
  tenant_id: string;
  id: string;
}

export interface GetArtifactBySlugInput {
  tenant_id: string;
  slug: string;
}

export interface InsertArtifactInput {
  id: string;
  tenant_id: string;
  slug: string;
  title: string;
  description: string | null;
  created_by_subject: Subject;
}

export interface UpdateArtifactInput {
  tenant_id: string;
  id: string;
  title: string;
  /** `undefined` leaves the stored description unchanged; `null` clears it. */
  description: string | null | undefined;
}

export interface DeleteArtifactInput {
  tenant_id: string;
  id: string;
}

export interface InsertArtifactVersionInput {
  id: string;
  tenant_id: string;
  artifact_id: string;
  version: number;
  entry_path: string;
  entry_content_type: ArtifactEntryContentType;
  file_count: number;
  total_size_bytes: number;
  manifest_sha256: string;
  session_id: string;
  turn_id: string;
  source_root: string;
  note: string | null;
  storage_backend: ArtifactStorageBackendName;
  storage_location: string;
  created_by_subject: Subject;
  files: readonly ArtifactFileRecord[];
}

export interface GetArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  version: number;
}

export interface ListArtifactVersionsInput {
  tenant_id: string;
  artifact_id: string;
  limit: number;
  page_token: string | undefined;
}

export interface ListArtifactVersionsResult {
  data: ArtifactVersionRecord[];
  pagination: TokenPagination;
}

export interface IArtifactStore<TTransaction = never> {
  listArtifacts(input: ListArtifactsInput, transaction?: TTransaction): Promise<ListArtifactsResult>;
  getArtifact(input: GetArtifactInput, transaction?: TTransaction): Promise<ArtifactRecord | undefined>;
  getArtifactBySlug(input: GetArtifactBySlugInput, transaction?: TTransaction): Promise<ArtifactRecord | undefined>;
  /** Row lock on Postgres. SQLite relies on the caller's write transaction. */
  getArtifactForUpdate(input: GetArtifactInput, transaction: TTransaction): Promise<ArtifactRecord | undefined>;
  insertArtifact(input: InsertArtifactInput, transaction?: TTransaction): Promise<ArtifactRecord>;
  updateArtifact(input: UpdateArtifactInput, transaction?: TTransaction): Promise<ArtifactRecord | undefined>;
  deleteArtifact(input: DeleteArtifactInput, transaction?: TTransaction): Promise<boolean>;
  insertVersion(input: InsertArtifactVersionInput, transaction?: TTransaction): Promise<ArtifactVersionRecord>;
  getVersion(input: GetArtifactVersionInput, transaction?: TTransaction): Promise<ArtifactVersionRecord | undefined>;
  getVersionById(
    input: { tenant_id: string; id: string },
    transaction?: TTransaction,
  ): Promise<ArtifactVersionRecord | undefined>;
  listVersions(input: ListArtifactVersionsInput, transaction?: TTransaction): Promise<ListArtifactVersionsResult>;
  /** Every version's storage prefix, for deletion. Versions are few (one per publish). */
  listVersionLocations(
    input: { tenant_id: string; artifact_id: string },
    transaction?: TTransaction,
  ): Promise<Pick<ArtifactVersionRecord, 'storage_backend' | 'storage_location'>[]>;
  listFiles(
    input: { tenant_id: string; artifact_version_id: string },
    transaction?: TTransaction,
  ): Promise<ArtifactFileRecord[]>;
  listFilesForVersions(
    input: { tenant_id: string; artifact_version_ids: readonly string[] },
    transaction?: TTransaction,
  ): Promise<{ artifact_version_id: string; file: ArtifactFileRecord }[]>;
  /** Latest version of each artifact, in one query. Ids with no version are omitted. */
  listLatestVersions(
    input: { tenant_id: string; artifact_ids: readonly string[] },
    transaction?: TTransaction,
  ): Promise<ArtifactVersionRecord[]>;
  /** Bytes held by every version of every artifact in the tenant. */
  sumVersionBytes(input: { tenant_id: string }, transaction?: TTransaction): Promise<number>;
}
