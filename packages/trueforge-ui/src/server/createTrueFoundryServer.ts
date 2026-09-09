import type {
  AgentBuilderCapabilitiesResponse,
  AgentBuilderServer,
  AgentChatServer,
  AgentLibraryEntry,
  AgentMetricsServer,
  AgentSessionsServer,
  AgentSkill,
  AgentSpec,
  CatalogServer,
  ConnectorState,
  ListResult,
  ModelSelection,
  PageParams,
  SaveAgentRequest,
  SaveAgentResult,
  ScheduleServer,
  SearchAgentsParams,
} from './types.js';

export type CreateTrueFoundryServerOptions<
  TSpec extends AgentSpec = AgentSpec,
  TModel extends ModelSelection = ModelSelection,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSave extends SaveAgentResult = SaveAgentResult,
  TCatalog extends CatalogServer = CatalogServer,
  TCapabilities extends AgentBuilderCapabilitiesResponse = AgentBuilderCapabilitiesResponse,
  TSessions extends AgentSessionsServer<TSpec> = AgentSessionsServer<TSpec>,
  TMetrics extends AgentMetricsServer = AgentMetricsServer,
  TSchedules extends ScheduleServer = ScheduleServer,
> = {
  /** Chat port — e.g. from `@truefoundry/agent-server-adapter`. */
  chatServer: AgentChatServer<TSpec>;
  getCapabilities: () => Promise<TCapabilities>;
  getModels: () => Promise<TModel[]>;
  getSkills: () => Promise<TSkill[]>;
  getMcp: () => Promise<TMcp[]>;
  listMcp?: (req?: PageParams) => Promise<ListResult<TMcp>>;
  getMcpTools?: AgentBuilderServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCapabilities>['getMcpTools'];
  searchAgents: (req?: SearchAgentsParams) => Promise<TAgent[]>;
  saveAgent: (req: SaveAgentRequest<TSpec>) => Promise<TSave>;
  deleteAgent?: (req: { agentName: string }) => Promise<void>;
  /** Settings catalog (models + connectors). Optional. */
  catalog?: TCatalog;
  /** Optional agent-detail port (Overview + Use In Code). */
  sessions?: TSessions;
  /** Optional aggregate metrics + chart port. */
  metrics?: TMetrics;
  /** Schedules listing + CRUD. Optional. */
  schedules?: TSchedules;
};

export type TrueFoundryServer<
  TSpec extends AgentSpec = AgentSpec,
  TModel extends ModelSelection = ModelSelection,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSave extends SaveAgentResult = SaveAgentResult,
  TCatalog extends CatalogServer = CatalogServer,
  TCapabilities extends AgentBuilderCapabilitiesResponse = AgentBuilderCapabilitiesResponse,
  TSessions extends AgentSessionsServer<TSpec> = AgentSessionsServer<TSpec>,
  TMetrics extends AgentMetricsServer = AgentMetricsServer,
  TSchedules extends ScheduleServer = ScheduleServer,
> = AgentChatServer<TSpec> &
  AgentBuilderServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCapabilities> & {
    catalog?: TCatalog;
    sessions?: TSessions;
    metrics?: TMetrics;
    schedules?: TSchedules;
  };

/**
 * Composes an `AgentChatServer` with host-provided builder catalog callbacks
 * and an optional settings `catalog`.
 * Gateway wiring lives in the host (or `@truefoundry/agent-server-adapter`).
 */
export function createTrueFoundryServer<
  TSpec extends AgentSpec = AgentSpec,
  TModel extends ModelSelection = ModelSelection,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSave extends SaveAgentResult = SaveAgentResult,
  TCatalog extends CatalogServer = CatalogServer,
  TCapabilities extends AgentBuilderCapabilitiesResponse = AgentBuilderCapabilitiesResponse,
  TSessions extends AgentSessionsServer<TSpec> = AgentSessionsServer<TSpec>,
  TMetrics extends AgentMetricsServer = AgentMetricsServer,
  TSchedules extends ScheduleServer = ScheduleServer,
>(
  opts: CreateTrueFoundryServerOptions<
    TSpec,
    TModel,
    TSkill,
    TMcp,
    TAgent,
    TSave,
    TCatalog,
    TCapabilities,
    TSessions,
    TMetrics,
    TSchedules
  >,
): TrueFoundryServer<
  TSpec,
  TModel,
  TSkill,
  TMcp,
  TAgent,
  TSave,
  TCatalog,
  TCapabilities,
  TSessions,
  TMetrics,
  TSchedules
> {
  const builder: AgentBuilderServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCapabilities> = {
    getCapabilities: opts.getCapabilities,
    getModels: opts.getModels,
    getSkills: opts.getSkills,
    getMcp: opts.getMcp,
    ...(opts.listMcp === undefined ? {} : { listMcp: opts.listMcp }),
    ...(opts.getMcpTools === undefined ? {} : { getMcpTools: opts.getMcpTools }),
    searchAgents: opts.searchAgents,
    saveAgent: opts.saveAgent,
    deleteAgent: async req => {
      if (opts.deleteAgent) {
        await opts.deleteAgent(req);
        return;
      }
      throw new Error('deleteAgent is host-owned. Pass deleteAgent to createTrueFoundryServer.');
    },
  };

  const server: TrueFoundryServer<
    TSpec,
    TModel,
    TSkill,
    TMcp,
    TAgent,
    TSave,
    TCatalog,
    TCapabilities,
    TSessions,
    TMetrics,
    TSchedules
  > = {
    ...opts.chatServer,
    ...builder,
    ...(opts.catalog != null ? { catalog: opts.catalog } : {}),
    ...(opts.sessions != null ? { sessions: opts.sessions } : {}),
    ...(opts.metrics != null ? { metrics: opts.metrics } : {}),
    ...(opts.schedules != null ? { schedules: opts.schedules } : {}),
  };
  return server;
}
