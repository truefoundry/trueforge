/** Partial unique index on `session (tenant_id, external_id) WHERE external_id IS NOT NULL`. */
export const SESSION_EXTERNAL_ID_UQ = 'session_external_id_uq';

/** Partial unique index on `agent (tenant_id, external_id) WHERE external_id IS NOT NULL`. */
export const AGENT_EXTERNAL_ID_UQ = 'agent_external_id_uq';

/** GIN index for `session.metadata` containment queries (`@>`). */
export const SESSION_METADATA_GIN = 'session_metadata_gin';

/** `(tenant_id, created_by_subject.subject_id)` on agent. */
export const AGENT_CREATED_BY_SUBJECT_ID_IDX = 'agent_created_by_subject_id_idx';

/** `(tenant_id, created_by_subject.subject_id)` on session. */
export const SESSION_CREATED_BY_SUBJECT_ID_IDX = 'session_created_by_subject_id_idx';

/** `(tenant_id, created_by_subject.subject_id)` on schedule. */
export const SCHEDULE_CREATED_BY_SUBJECT_ID_IDX = 'schedule_created_by_subject_id_idx';

/** `(tenant_id, agent_id)` on schedule — list schedules for one agent by id. */
export const SCHEDULE_AGENT_ID_IDX = 'schedule_agent_id_idx';

/** `(tenant_id, created_by_subject.subject_id)` on schedule_run. */
export const SCHEDULE_RUN_CREATED_BY_SUBJECT_ID_IDX = 'schedule_run_created_by_subject_id_idx';
