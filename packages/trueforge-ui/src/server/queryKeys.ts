import type {
  AgentMetricChartDataRequest,
  AgentMetricRangeRequest,
  ListSandboxEnvironmentsParams,
  ListSchedulesParams,
  ListSessionEventsParams,
  ListSessionsParams,
  PermissionResourceType,
  SearchAgentsParams,
} from './types.js';

const ROOT = 'trueforge';

/** Prefixes every key with `ROOT` and keeps the segments as a tuple. */
function key<const T extends readonly unknown[]>(...parts: T): readonly [typeof ROOT, ...T] {
  return [ROOT, ...parts];
}

type SessionHistoryPageParams = {
  sessionId: string;
  pageToken?: string;
  lastTurnId?: string;
  limit?: number;
  /** Session `updatedAt` the newest page was read against; omitted for older pages. */
  version?: string;
};

/** Query keys for server reads; one QueryClient exists per server, so keys need no server scope. */
export const queryKeys = {
  capabilities: () => key('capabilities'),
  me: () => key('me'),
  permissions: {
    all: () => key('permissions'),
    tenant: () => key('permissions', 'tenant'),
    list: ({ resourceType, resourceIds }: { resourceType: PermissionResourceType; resourceIds: readonly string[] }) =>
      key('permissions', 'resources', resourceType, resourceIds),
    /** Resource type of a `list` key. */
    listResourceType: (queryKey: readonly unknown[]): unknown => queryKey[3],
  },
  catalog: {
    all: () => key('catalog'),
    models: () => key('catalog', 'models'),
    skills: () => key('catalog', 'skills'),
    mcp: () => key('catalog', 'mcp'),
    connectorCatalog: () => key('catalog', 'connector-catalog'),
    mcpConnectors: () => key('catalog', 'mcp-connector'),
    mcpConnector: (connectorId: string) => key('catalog', 'mcp-connector', connectorId),
    mcpToolsAll: () => key('catalog', 'mcp-tools'),
    mcpTools: (connectorId: string) => key('catalog', 'mcp-tools', connectorId),
  },
  agents: {
    all: () => key('agents'),
    search: (params: SearchAgentsParams) => key('agents', 'search', params),
    searchPages: (params: Omit<SearchAgentsParams, 'pageToken'>) => key('agents', 'search-pages', params),
  },
  sessions: {
    all: () => key('sessions'),
    lists: () => key('sessions', 'list'),
    list: (params: ListSessionsParams) => key('sessions', 'list', params),
    /** Infinite pages for the sessions browser; nested under `lists()` so session invalidation reaches them. */
    pages: (params: ListSessionsParams) => key('sessions', 'list', 'pages', params),
    lastRun: (agentId: string) => key('sessions', 'list', 'last-run', agentId),
    detail: (sessionId: string) => key('sessions', 'detail', sessionId),
    events: (params: ListSessionEventsParams) => key('sessions', 'events', params),
  },
  /** Chat history pages; kept outside `sessions` so session-list invalidation does not evict them. */
  sessionHistory: {
    session: (sessionId: string) => key('session-history', sessionId),
    page: (params: SessionHistoryPageParams) => key('session-history', params.sessionId, params),
  },
  /** Admin settings lists; mutations also invalidate the matching `catalog` entries pickers read. */
  settings: {
    all: () => key('settings'),
    modelProviderCatalog: () => key('settings', 'model-provider-catalog'),
    modelProviders: () => key('settings', 'model-providers'),
    connectors: (query?: string) => key('settings', 'connectors', query ?? ''),
    connector: (id: string) => key('settings', 'connector', id),
    connectorToolsAll: () => key('settings', 'connector-tools'),
    connectorTools: (id: string) => key('settings', 'connector-tools', id),
    skillCatalog: () => key('settings', 'skill-catalog'),
    skills: (query?: string) => key('settings', 'skills', query ?? ''),
    sandboxProviderCatalog: () => key('settings', 'sandbox-provider-catalog'),
    sandboxProviders: (query?: string) => key('settings', 'sandbox-providers', query ?? ''),
    webSearchProviderCatalog: () => key('settings', 'web-search-provider-catalog'),
    webSearchProviders: (query?: string) => key('settings', 'web-search-providers', query ?? ''),
  },
  agentDetails: {
    all: () => key('agent-details'),
    agent: (agentId: string) => key('agent-details', 'agent', agentId),
    codeSnippets: (agentId: string) => key('agent-details', 'code-snippets', agentId),
  },
  schedules: {
    all: () => key('schedules'),
    list: (params: ListSchedulesParams) => key('schedules', 'list', params),
    detail: (scheduleId: string) => key('schedules', 'detail', scheduleId),
    runs: (scheduleId: string) => key('schedules', 'runs', scheduleId),
    forAgents: (agentIds: readonly string[]) => key('schedules', 'for-agents', agentIds),
  },
  environments: {
    all: () => key('environments'),
    list: (params: ListSandboxEnvironmentsParams) => key('environments', 'list', params),
    allPages: (params: ListSandboxEnvironmentsParams) => key('environments', 'all-pages', params),
    detail: (name: string) => key('environments', 'detail', name),
  },
  metrics: {
    all: () => key('metrics'),
    charts: () => key('metrics', 'charts'),
    meters: (params: AgentMetricRangeRequest) => key('metrics', 'meters', params),
    chartData: (params: AgentMetricChartDataRequest) => key('metrics', 'chart-data', params),
  },
};
