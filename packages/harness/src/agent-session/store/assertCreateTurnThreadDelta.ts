import { SessionStoreInvariantError } from './SessionStoreErrors';

/**
 * Pure createTurn thread-graph checks shared by all ISessionStore backends.
 * Call after previous-turn thread ids are known; no DB I/O.
 * Returns the resulting thread-id set (previous ∪ new_threads).
 */
export function assertCreateTurnThreadDelta(input: {
  previousThreadIds: ReadonlySet<string>;
  new_threads: readonly { thread_id: string }[];
  new_context_appends: readonly { thread_id: string }[];
  capability_states: readonly { thread_id: string }[];
}): Set<string> {
  const newThreadIds = new Set<string>();
  for (const nt of input.new_threads) {
    if (input.previousThreadIds.has(nt.thread_id) || newThreadIds.has(nt.thread_id)) {
      throw new SessionStoreInvariantError(
        `new_threads must only contain threads absent on the previous turn; thread '${nt.thread_id}' already exists`,
      );
    }
    newThreadIds.add(nt.thread_id);
  }

  const knownThreadIds = new Set(input.previousThreadIds);
  for (const threadId of newThreadIds) {
    knownThreadIds.add(threadId);
  }

  for (const append of input.new_context_appends) {
    if (!knownThreadIds.has(append.thread_id)) {
      throw new SessionStoreInvariantError(`new_context_appends references unknown thread ${append.thread_id}`);
    }
  }

  const seenCapabilityThreads = new Set<string>();
  for (const capability of input.capability_states) {
    if (!knownThreadIds.has(capability.thread_id)) {
      throw new SessionStoreInvariantError(`capability_states references unknown thread ${capability.thread_id}`);
    }
    if (seenCapabilityThreads.has(capability.thread_id)) {
      throw new SessionStoreInvariantError(`capability_states contains duplicate thread ${capability.thread_id}`);
    }
    seenCapabilityThreads.add(capability.thread_id);
  }
  for (const threadId of knownThreadIds) {
    if (!seenCapabilityThreads.has(threadId)) {
      throw new SessionStoreInvariantError(`capability_states is missing thread ${threadId}`);
    }
  }

  return knownThreadIds;
}
