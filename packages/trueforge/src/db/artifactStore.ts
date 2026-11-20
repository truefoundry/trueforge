import type { Subject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import slugify from 'slugify';
import { MAX_TITLE_LENGTH } from '../schemas/common';
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
  /** Trimmed; 1 to `MAX_TITLE_LENGTH` characters. */
  title: string;
  created_by_subject: Subject;
  created_by_session_id: string;
}

export interface ListArtifactsInput {
  tenant_id: string;
  created_by_subject_id: string;
  created_by_session_id: string | undefined;
  /** Case-insensitive substring match. */
  title: string | undefined;
  /** Inclusive `updated_at` bounds; take priority over the created range. */
  last_updated_from: Date | undefined;
  last_updated_to: Date | undefined;
  /** Inclusive `created_at` bounds; ignored when a last-updated bound is set. */
  created_from: Date | undefined;
  created_to: Date | undefined;
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

/** Length of ULID characters appended at the end of cleaned title to get slug */
const SLUG_ID_SUFFIX_LENGTH = 6;

/**
 * New artifact id and `<cleaned-title>-<id suffix>` slug. Throws `RangeError` when the trimmed
 * title is empty or longer than `MAX_TITLE_LENGTH`.
 */
export function newArtifactIdentity(rawTitle: string): { id: string; title: string; slug: string } {
  const title = rawTitle.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new RangeError(`Artifact title must be 1-${String(MAX_TITLE_LENGTH)} characters`);
  }
  const id = newId();
  const suffix = id.slice(-SLUG_ID_SUFFIX_LENGTH);
  // Drop symbols slugify would spell out (`€` -> `euro`, `&` -> `and`). Transliteration can still
  // lengthen letters (`ß` -> `ss`), so the cleaned title is capped after slugify.
  const base = slugify(title.replace(/[\p{S}%&]/gu, ' '), { lower: true, strict: true, trim: true })
    .slice(0, MAX_TITLE_LENGTH - SLUG_ID_SUFFIX_LENGTH)
    .replace(/-+$/, '');
  return { id, title, slug: base === '' ? suffix : `${base}-${suffix}` };
}

export function listArtifactsTimeRange(
  input: Pick<ListArtifactsInput, 'last_updated_from' | 'last_updated_to' | 'created_from' | 'created_to'>,
): { column: 'updated_at' | 'created_at'; from: Date | undefined; to: Date | undefined } | undefined {
  if (input.last_updated_from !== undefined || input.last_updated_to !== undefined) {
    return { column: 'updated_at', from: input.last_updated_from, to: input.last_updated_to };
  }
  if (input.created_from !== undefined || input.created_to !== undefined) {
    return { column: 'created_at', from: input.created_from, to: input.created_to };
  }
  return undefined;
}

export interface IArtifactStore {
  /** Generates the id and slug from the title (see `newArtifactIdentity`). */
  createArtifact(input: CreateArtifactInput): Promise<ArtifactRecord>;
  /** Most recently updated first. */
  listArtifacts(input: ListArtifactsInput): Promise<{ data: ArtifactRecord[]; pagination: TokenPagination }>;
  /**
   * Atomically inserts the next version for files already uploaded under `storage_prefix` and
   * advances `latest_version` and `updated_at`. Undefined when the artifact is not in the tenant.
   */
  createVersion(input: CreateArtifactVersionInput): Promise<ArtifactVersionRecord | undefined>;
  getVersion(input: GetArtifactVersionInput): Promise<ArtifactVersionRecord | undefined>;
}
