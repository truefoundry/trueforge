import type { Subject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import type { ArtifactVersionMetadata } from '../schemas/artifact';

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
  created_by_subject: Subject;
  created_by_session_id: string;
  /** Creating session's registry agent; null for inline-spec sessions. */
  created_by_agent_id: string | null;
  /** ISO-8601 UTC instant. */
  created_at: string;
}

export interface CreateArtifactInput {
  tenant_id: string;
  name: string;
  created_by_subject: Subject;
  created_by_session_id: string;
  /** The session's registry agent; null for inline-spec sessions. */
  created_by_agent_id: string | null;
}

export interface ListArtifactsInput {
  tenant_id: string;
  created_by_subject_id: string;
  /** Case-insensitive substring match. */
  name: string | undefined;
  limit: number;
  page_token: string | undefined;
}

export interface GetArtifactInput {
  tenant_id: string;
  id: string;
}

export interface UpdateArtifactInput {
  tenant_id: string;
  id: string;
  created_by_subject_id: string;
  name: string;
}

export interface CreateArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  files_metadata: ArtifactVersionMetadata;
  created_by_subject: Subject;
  created_by_session_id: string;
  /** The session's registry agent; null for inline-spec sessions. */
  created_by_agent_id: string | null;
}

export interface GetArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  version: number;
}

export interface IArtifactStore {
  /** Generates the id. */
  createArtifact(input: CreateArtifactInput): Promise<ArtifactRecord>;
  /** Undefined when the artifact is not in the tenant. */
  getArtifact(input: GetArtifactInput): Promise<ArtifactRecord | undefined>;
  /**
   * Refreshes `updated_at`. Undefined when the artifact is missing, in another
   * tenant, or not created by `created_by_subject_id`.
   */
  updateArtifact(input: UpdateArtifactInput): Promise<ArtifactRecord | undefined>;
  /** Most recently updated first. */
  listArtifacts(input: ListArtifactsInput): Promise<{ data: ArtifactRecord[]; pagination: TokenPagination }>;
  /**
   * Atomically inserts the next version for files already uploaded for it and
   * advances `latest_version`, `latest_entry_point` and `updated_at`. Undefined when the artifact is not in the tenant.
   */
  createVersion(input: CreateArtifactVersionInput): Promise<ArtifactVersionRecord | undefined>;
  getVersion(input: GetArtifactVersionInput): Promise<ArtifactVersionRecord | undefined>;
}
