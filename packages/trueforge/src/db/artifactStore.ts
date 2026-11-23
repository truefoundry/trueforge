import type { Subject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import { MAX_TITLE_LENGTH } from '../schemas/common';
import { newId } from '../utils/id';

export interface ArtifactRecord {
  id: string;
  tenant_id: string;
  title: string;
  /** Highest version; 0 until the first version. */
  latest_version: number;
  /** Latest version's `entry_point`; null until the first version. */
  entry_point: string | null;
  created_by_subject: Subject;
  created_by_session_id: string;
  /** Creating session's registry agent; null for inline-spec sessions. */
  created_by_agent_id: string | null;
  /** ISO-8601 UTC instant. */
  created_at: string;
  /** ISO-8601 UTC instant. */
  updated_at: string;
}

export interface ArtifactVersionRecord {
  artifact_id: string;
  version: number;
  /** Path of the default file to render, relative to the version's files. */
  entry_point: string;
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
  /** The session's registry agent; null for inline-spec sessions. */
  created_by_agent_id: string | null;
}

export interface ListArtifactsInput {
  tenant_id: string;
  created_by_subject_id: string;
  created_by_session_id: string | undefined;
  /** Case-insensitive substring match. */
  title: string | undefined;
  limit: number;
  page_token: string | undefined;
}

export interface CreateArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  entry_point: string;
  total_bytes: number;
}

export interface GetArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  version: number;
}

/**
 * New artifact id and trimmed title. Throws `RangeError` when the trimmed title is empty or
 * longer than `MAX_TITLE_LENGTH`.
 */
export function newArtifactIdentity(rawTitle: string): { id: string; title: string } {
  const title = rawTitle.trim();
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) {
    throw new RangeError(`Artifact title must be 1-${String(MAX_TITLE_LENGTH)} characters`);
  }
  return { id: newId(), title };
}

export interface IArtifactStore {
  /** Generates the id and validates the title (see `newArtifactIdentity`). */
  createArtifact(input: CreateArtifactInput): Promise<ArtifactRecord>;
  /** Most recently updated first. */
  listArtifacts(input: ListArtifactsInput): Promise<{ data: ArtifactRecord[]; pagination: TokenPagination }>;
  /**
   * Atomically inserts the next version for files already uploaded for it and
   * advances `latest_version` and `updated_at`. Undefined when the artifact is not in the tenant.
   */
  createVersion(input: CreateArtifactVersionInput): Promise<ArtifactVersionRecord | undefined>;
  getVersion(input: GetArtifactVersionInput): Promise<ArtifactVersionRecord | undefined>;
}
