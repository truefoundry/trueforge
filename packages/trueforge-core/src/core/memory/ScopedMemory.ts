/** One remembered fact, in the provider-normalized shape. */
export interface MemoryFact {
  fact: string;
  /** ISO-8601 instant the fact became true, when the provider knows it. */
  valid_at: string | null;
  /** ISO-8601 instant the fact stopped being true; null while it still holds. */
  invalid_at: string | null;
}

/**
 * Long-term memory of one user, already bound by the host to the session's memory scope (tenant,
 * agent and user). It takes no identity arguments, so the agent can never reach another user's memory.
 */
export interface ScopedMemory {
  search(input: { query: string; limit: number }): Promise<MemoryFact[]>;
  /** Save something the user explicitly asked to be remembered. */
  add(input: { content: string }): Promise<void>;
}
