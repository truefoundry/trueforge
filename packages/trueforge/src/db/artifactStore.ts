import type { Subject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import slugify from 'slugify';
import { MAX_SESSION_TITLE_LENGTH } from '../schemas/session';
import { newId } from '../utils/id';

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
  /** Trimmed; 1 to `MAX_SESSION_TITLE_LENGTH` characters. */
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
  created_by_session_id: string | undefined;
  /** Case-insensitive substring match. */
  title: string | undefined;
  /** Inclusive lower bound on `updated_at`. */
  updated_since: Date | undefined;
  /** Exclusive upper bound on `updated_at`. */
  updated_before: Date | undefined;
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

/** ULID tail chars are random; head chars are the timestamp and repeat for ~17 minutes. */
const SLUG_ID_SUFFIX_LENGTH = 6;

/**
 * New artifact id and `<cleaned-title>-<id suffix>` slug. Throws `RangeError` when the trimmed
 * title is empty or longer than `MAX_SESSION_TITLE_LENGTH`.
 */
export function newArtifactIdentity(rawTitle: string): { id: string; title: string; slug: string } {
  const title = rawTitle.trim();
  if (title.length === 0 || title.length > MAX_SESSION_TITLE_LENGTH) {
    throw new RangeError(`Artifact title must be 1-${String(MAX_SESSION_TITLE_LENGTH)} characters`);
  }
  const id = newId();
  const suffix = id.slice(-SLUG_ID_SUFFIX_LENGTH);
  // slugify spells out symbols (`€` -> `euro`), so the cleaned title can outgrow the title cap.
  const base = slugify(title, { lower: true, strict: true, trim: true })
    .slice(0, MAX_SESSION_TITLE_LENGTH)
    .replace(/-+$/, '');
  return { id, title, slug: base === '' ? suffix : `${base}-${suffix}` };
}

export interface IArtifactStore<TTransaction = never> {
  /** Generates the id and slug from the title (see `newArtifactIdentity`). */
  createArtifact(input: CreateArtifactInput, transaction?: TTransaction): Promise<ArtifactRecord>;
  getArtifact(input: GetArtifactInput, transaction?: TTransaction): Promise<ArtifactRecord | undefined>;
  /** Most recently updated first. */
  listArtifacts(
    input: ListArtifactsInput,
    transaction?: TTransaction,
  ): Promise<{ data: ArtifactRecord[]; pagination: TokenPagination }>;
  /**
   * Inserts the next version for files already uploaded under `storage_prefix` and advances
   * `latest_version` and `updated_at`. Undefined when the artifact is not in the tenant.
   */
  createVersion(
    input: CreateArtifactVersionInput,
    transaction?: TTransaction,
  ): Promise<ArtifactVersionRecord | undefined>;
  getVersion(input: GetArtifactVersionInput, transaction?: TTransaction): Promise<ArtifactVersionRecord | undefined>;
}
