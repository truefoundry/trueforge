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
