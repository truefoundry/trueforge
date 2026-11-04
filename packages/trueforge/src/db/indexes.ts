/** Partial unique index on `session (tenant_id, external_id) WHERE external_id IS NOT NULL`. */
export const SESSION_EXTERNAL_ID_UQ = 'session_external_id_uq';

/** `(tenant_id, created_by_subject.subject_id)` on session. */
export const SESSION_CREATED_BY_SUBJECT_ID_IDX = 'session_created_by_subject_id_idx';

/**
 * `(tenant_id, source.type, source.id)` on session — list filter by source.
 * Partial WHERE source IS NOT NULL (interactive sessions omit source).
 */
export const SESSION_SOURCE_IDX = 'session_source_idx';

/** Partial unique index on `agent (tenant_id, external_id) WHERE external_id IS NOT NULL`. */
export const AGENT_EXTERNAL_ID_UQ = 'agent_external_id_uq';

/** GIN index for `session.metadata` containment queries (`@>`). */
export const SESSION_METADATA_GIN = 'session_metadata_gin';

/**
 * `(tenant_id, created_by_subject.subject_id, metadata.tfg.source, updated_at, session_id)` on
 * session — a caller's sessions for one `tfg.source` value (or none) in keyset order.
 */
export const SESSION_TFG_SOURCE_LIST_IDX = 'session_tfg_source_list_idx';

/** `(tenant_id, created_by_subject.subject_id)` on agent. */
export const AGENT_CREATED_BY_SUBJECT_ID_IDX = 'agent_created_by_subject_id_idx';

/** `(tenant_id, created_by_subject.subject_id)` on schedule. */
export const SCHEDULE_CREATED_BY_SUBJECT_ID_IDX = 'schedule_created_by_subject_id_idx';

/** `(tenant_id, agent_id)` on schedule — list schedules for one agent by id. */
export const SCHEDULE_AGENT_ID_IDX = 'schedule_agent_id_idx';

/** `(tenant_id, created_by_subject.subject_id)` on schedule_run. */
export const SCHEDULE_RUN_CREATED_BY_SUBJECT_ID_IDX = 'schedule_run_created_by_subject_id_idx';

/** Partial unique `(tenant_id, name) WHERE lifecycle_stage = 'active'` on sandbox_environment. */
export const SANDBOX_ENVIRONMENT_TENANT_NAME_ACTIVE_UQ = 'sandbox_environment_tenant_name_active_uq';

/** Unique `(environment_id, version)` on sandbox_environment_version. */
export const SANDBOX_ENVIRONMENT_VERSION_UQ = 'sandbox_environment_version_uq';

/** `(tenant_id, created_by_subject.subject_id)` on sandbox_environment. */
export const SANDBOX_ENVIRONMENT_CREATED_BY_SUBJECT_ID_IDX = 'sandbox_environment_created_by_subject_id_idx';

/** Unique `(environment_id, secret_name)` on sandbox_environment_secret. */
export const SANDBOX_ENVIRONMENT_SECRET_ENV_NAME_UQ = 'sandbox_environment_secret_environment_id_secret_name_uq';

/**
 * Partial `(tenant_id, agent_id, updated_at, session_id) WHERE agent_id IS NOT NULL` on session —
 * one agent's sessions in `listSessions` keyset order, so the page is read without a sort.
 */
export const SESSION_AGENT_LIST_IDX = 'session_agent_list_idx';

/**
 * Partial `(environment_id, version) WHERE status = 'pending'` on sandbox_environment_version —
 * the build controller's pending-tip poll (`listLatestPendingVersions`) without a full scan.
 */
export const SANDBOX_ENVIRONMENT_VERSION_PENDING_IDX = 'sandbox_environment_version_pending_idx';

/**
 * `(oauth_server_id)` on oauth_pending_authorization — backs the `ON DELETE CASCADE` FK to
 * mcp_server and `deletePendingAuthorizationsForServer`.
 */
export const OAUTH_PENDING_AUTHORIZATION_SERVER_ID_IDX = 'oauth_pending_authorization_oauth_server_id_idx';
