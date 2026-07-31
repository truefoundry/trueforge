/**
 * Leaf types for capability state. Extracted to break the circular import chain
 * AgentCapability → AgentContextProcessor → AgentThread.types → AgentCapability.
 */

/**
 * JSON-serializable value. Excludes `undefined` — durability is jsonb/JSON, so
 * clears use `null` and absent data omits the key or the map.
 */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

/** Cross-turn capability KV map. Keys: capability.state.key; `tfy.` reserved for builtins. */
export type CapabilityState = Record<string, JsonValue>;
