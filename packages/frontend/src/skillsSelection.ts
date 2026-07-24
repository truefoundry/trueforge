import { useSyncExternalStore } from 'react';

/**
 * Selected skills, shared between the composer chip and the catalog panel
 * (separate component instances). Local-only — harness rejects agent_spec.skills.
 */
let selectedSkillNames: ReadonlySet<string> = new Set();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setSelectedSkillNames(next: ReadonlySet<string>): void {
  selectedSkillNames = new Set(next);
  for (const listener of listeners) listener();
}

export function useSelectedSkillNames(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => selectedSkillNames);
}
