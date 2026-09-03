/** Partial unique index on `session (tenant_id, external_id) WHERE external_id IS NOT NULL`. */
export const SESSION_EXTERNAL_ID_UQ = 'session_external_id_uq';

/** Partial unique index on `agent (tenant_id, external_id) WHERE external_id IS NOT NULL`. */
export const AGENT_EXTERNAL_ID_UQ = 'agent_external_id_uq';
