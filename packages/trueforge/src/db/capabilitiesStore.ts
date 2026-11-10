/**
 * Extra capabilities to add to the agent's capabilities list.
 * Implementations: EmptyCapabilitiesStore and InlineCapabilitiesStore (`x-tfg-tools`).
 */
import type { AgentCapability } from '@truefoundry/trueforge-core/core';

export interface ICapabilitiesStore {
  /** Fresh instances on every call. Empty when this turn mounts no header tools. */
  list(): AgentCapability[];
}

/** Schedules and turns with no `x-tfg-tools` mount nothing. */
export class EmptyCapabilitiesStore implements ICapabilitiesStore {
  list(): AgentCapability[] {
    return [];
  }
}
