export type AgentCapabilityValues = {
  generativeUi: boolean;
  dynamicSubAgents: boolean;
  askUserQuestions: boolean;
  webSearch: boolean;
};

/** Shown when the host locks web search without saying why. */
export const WEB_SEARCH_UNAVAILABLE_HINT = 'Web search is not configured';

/** Shown while a spec keeps web search the host no longer allows, so the last turn-off is final. */
export const WEB_SEARCH_ONE_WAY_OFF_HINT =
  'Web search is off for this tenant. Turning it off here is final until an admin turns it back on.';

/**
 * How a draft should present the web search row.
 *
 * `enabled` is what the spec currently says. Null capabilities mean the host has not
 * answered yet, which is not a refusal, so nothing is locked until it has; otherwise the
 * row would flash locked and then unlock on first paint.
 */
export function webSearchGate({
  capabilities,
  enabled,
}: {
  capabilities: { webSearch?: { enabled: boolean } | undefined } | null;
  enabled: boolean;
}): { locked: boolean; offIsFinal: boolean } {
  if (capabilities == null) {
    return { locked: false, offIsFinal: false };
  }
  const available = capabilities.webSearch?.enabled === true;
  return { locked: !available && !enabled, offIsFinal: enabled && !available };
}

export const MEMORY_UNAVAILABLE_HINT = 'Memory is turned off for this tenant';

/** Shown while a spec keeps memory the tenant no longer allows, so the last turn-off is final. */
export const MEMORY_ONE_WAY_OFF_HINT =
  'Memory is off for this tenant. Turning it off here is final until an admin turns it back on.';

/**
 * How a draft should present the memory row. A host that does not report memory does not
 * offer it, so the row stays hidden until capabilities load and say otherwise.
 */
export function memoryGate({
  capabilities,
  enabled,
}: {
  capabilities: { memory?: { enabled: boolean } | undefined } | null;
  enabled: boolean;
}): { hidden: boolean; locked: boolean; offIsFinal: boolean } {
  const memory = capabilities?.memory;
  if (memory === undefined) {
    return { hidden: true, locked: false, offIsFinal: false };
  }
  return { hidden: false, locked: !memory.enabled && !enabled, offIsFinal: enabled && !memory.enabled };
}
