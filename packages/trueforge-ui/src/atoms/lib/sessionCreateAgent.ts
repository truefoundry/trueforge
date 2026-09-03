/** Session metadata key for New Chat vs New Agent builder intent (wire/jsonb snake_case). */
export const IS_CREATE_AGENT_METADATA_KEY = 'is_create_agent';

/** Wire metadata values are strings (`SessionMetadataSchema`). */
export function isCreateAgentMetadataValue(isCreateAgent: boolean): 'true' | 'false' {
  return isCreateAgent ? 'true' : 'false';
}

/**
 * Read create-agent intent from session metadata.
 * Missing / undefined / anything other than `"true"` → false (legacy = Chat).
 */
export function readSessionIsCreateAgent(metadata: Record<string, string> | null | undefined): boolean {
  if (metadata == null) return false;
  return Reflect.get(metadata, IS_CREATE_AGENT_METADATA_KEY) === 'true';
}

/** True when a UI session was stamped as agent-builder (own prop or metadata). */
export function sessionIsCreateAgent(session: object): boolean {
  if ('isCreateAgent' in session && Reflect.get(session, 'isCreateAgent') === true) {
    return true;
  }
  if (!('metadata' in session)) return false;
  const metadata = Reflect.get(session, 'metadata');
  if (typeof metadata !== 'object' || metadata === null) return false;
  const record: Record<string, string> = {};
  for (const key of Object.keys(metadata)) {
    const value = Reflect.get(metadata, key);
    if (typeof value !== 'string') continue;
    record[key] = value;
  }
  return readSessionIsCreateAgent(record);
}
