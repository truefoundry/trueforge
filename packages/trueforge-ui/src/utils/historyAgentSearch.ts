export const TRY_AGENT_NAME_QUERY = 'try_agent_name';
export const HISTORY_AGENT_NAME_QUERY = 'history_agent_name';

export type HistoryAgentIntent = 'try-agent' | 'history';

export type HistoryAgentSearch = {
  intent: HistoryAgentIntent;
  agentName: string;
};

function nonEmpty(value: string | null): string | null {
  return value != null && value.length > 0 ? value : null;
}

export function readHistoryAgentSearch(search: string): HistoryAgentSearch | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const tryAgentName = nonEmpty(params.get(TRY_AGENT_NAME_QUERY));
  if (tryAgentName != null) return { intent: 'try-agent', agentName: tryAgentName };
  const historyAgentName = nonEmpty(params.get(HISTORY_AGENT_NAME_QUERY));
  return historyAgentName == null ? null : { intent: 'history', agentName: historyAgentName };
}

export function writeHistoryAgentSearch(params: URLSearchParams, next: HistoryAgentSearch | null): void {
  params.delete(TRY_AGENT_NAME_QUERY);
  params.delete(HISTORY_AGENT_NAME_QUERY);
  if (next == null) return;
  params.set(next.intent === 'try-agent' ? TRY_AGENT_NAME_QUERY : HISTORY_AGENT_NAME_QUERY, next.agentName);
}

export function updateHistoryAgentSearch(search: string, next: HistoryAgentSearch | null): string {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  writeHistoryAgentSearch(params, next);
  const updated = params.toString();
  return updated.length > 0 ? `?${updated}` : '';
}
