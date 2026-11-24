import type { Subject, TokenPagination } from '@truefoundry/trueforge-core/agent-session';
import { MAX_TITLE_LENGTH } from '../schemas/common';
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
  /** Path of the default file to render, relative to the version's files. */
  entry_point: string;
  total_bytes: number;
  /** ISO-8601 UTC instant. */
  created_at: string;
}

export interface CreateArtifactInput {
  tenant_id: string;
  /** Validated and normalized by `normalizeArtifactName`. */
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

export interface GetArtifactInput {
  tenant_id: string;
  id: string;
  created_by_subject_id: string;
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
  entry_point: string;
  total_bytes: number;
}

export interface GetArtifactVersionInput {
  tenant_id: string;
  artifact_id: string;
  version: number;
}

/** Control characters, bidi embeddings/overrides/isolates, and characters disallowed in file names. */
const FORBIDDEN_ARTIFACT_NAME_CHARACTERS = /[\p{Cc}\u202A-\u202E\u2066-\u2069/\\:*?"<>|]/u;

/**
 * Rejects forbidden characters, collapses whitespace (incl. line/paragraph separators) to one space, and trims.
 * Throws `RangeError` when the name has forbidden characters, is empty or longer than `MAX_TITLE_LENGTH`, or ends with a dot.
 */
export function normalizeArtifactName(rawName: string): string {
  if (FORBIDDEN_ARTIFACT_NAME_CHARACTERS.test(rawName)) {
    throw new RangeError('Artifact name must not contain control, bidi, or / \\ : * ? " < > | characters.');
  }
  const name = rawName.replace(/\s+/gu, ' ').trim();
  if (name.length === 0 || name.length > MAX_TITLE_LENGTH) {
    throw new RangeError(`Artifact name must be 1-${String(MAX_TITLE_LENGTH)} characters.`);
  }
  if (name.endsWith('.')) {
    throw new RangeError('Artifact name must not end with a dot.');
  }
  return name;
}

export interface IArtifactStore {
  /** Generates the id and validates the name (see `normalizeArtifactName`). */
  createArtifact(input: CreateArtifactInput): Promise<ArtifactRecord>;
  /** Undefined when the artifact is missing, in another tenant, or not created by `created_by_subject_id`. */
  getArtifact(input: GetArtifactInput): Promise<ArtifactRecord | undefined>;
  /**
   * Normalizes the name and refreshes `updated_at`. Undefined when the artifact is missing, in another
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
