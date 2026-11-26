import type { Subject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import type { ArtifactVersionMetadata } from '../schemas/artifact';
import { MAX_TITLE_LENGTH } from '../schemas/common';
import { newId } from '../utils/id';

export interface ArtifactRecord {
  id: string;
  tenant_id: string;
  name: string;
  /** Highest version; 0 until the first version. */
  latest_version: number;
  /** Latest version's `entry_point`; null until the first version. */
  latest_entry_point: string | null;
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
  files_metadata: ArtifactVersionMetadata;
  created_by_session_id: string;
  /** Creating session's registry agent; null for inline-spec sessions. */
  created_by_agent_id: string | null;
  /** ISO-8601 UTC instant. */
  created_at: string;
}

export interface CreateArtifactInput {
  tenant_id: string;
  /** Trimmed; 1 to `MAX_TITLE_LENGTH` characters. */
  name: string;
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
  name: string | undefined;
  limit: number;
  page_token: string | undefined;
}

export interface CreateArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  files_metadata: ArtifactVersionMetadata;
  created_by_session_id: string;
  /** The session's registry agent; null for inline-spec sessions. */
  created_by_agent_id: string | null;
}

export interface GetArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  version: number;
}

/**
 * New artifact id and trimmed name. Throws `RangeError` when the trimmed name is empty or
 * longer than `MAX_TITLE_LENGTH`.
 */
export function newArtifactIdentity(rawName: string): { id: string; name: string } {
  const name = rawName.trim();
  if (name.length === 0 || name.length > MAX_TITLE_LENGTH) {
    throw new RangeError(`Artifact name must be 1-${String(MAX_TITLE_LENGTH)} characters`);
  }
  return { id: newId(), name };
}

export interface IArtifactStore {
  /** Generates the id and validates the name (see `newArtifactIdentity`). */
  createArtifact(input: CreateArtifactInput): Promise<ArtifactRecord>;
  /** Most recently updated first. */
  listArtifacts(input: ListArtifactsInput): Promise<{ data: ArtifactRecord[]; pagination: TokenPagination }>;
  /**
   * Atomically inserts the next version for files already uploaded for it and
   * advances `latest_version`, `latest_entry_point` and `updated_at`. Undefined when the artifact is not in the tenant.
   */
  createVersion(input: CreateArtifactVersionInput): Promise<ArtifactVersionRecord | undefined>;
  getVersion(input: GetArtifactVersionInput): Promise<ArtifactVersionRecord | undefined>;
}
