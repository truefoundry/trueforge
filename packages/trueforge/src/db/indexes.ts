/** Partial unique index on `session (tenant_id, external_id) WHERE external_id IS NOT NULL`. */
export const SESSION_EXTERNAL_ID_UQ = 'session_external_id_uq';

/** Partial unique index on `agent (tenant_id, external_id) WHERE external_id IS NOT NULL`. */
export const AGENT_EXTERNAL_ID_UQ = 'agent_external_id_uq';

/**
 * Partial GIN on non-empty `session.metadata` for listSessions containment (`@>`).
 * `jsonb_path_ops` — containment only (not key-existence operators).
 */
export const SESSION_METADATA_GIN = 'session_metadata_gin';
