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
  ModelSelection,
  PermissionsServer,
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
  TPermissions extends PermissionsServer = PermissionsServer,
> = {
  /** Chat port — e.g. from `@truefoundry/agent-server-adapter`. */
  chatServer: AgentChatServer<TSpec>;
  getCapabilities: () => Promise<TCapabilities>;
  getModels: () => Promise<TModel[]>;
  getSkills: () => Promise<TSkill[]>;
  getMcp: () => Promise<TMcp[]>;
  getMcpConnector?: AgentBuilderServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCapabilities>['getMcpConnector'];
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
  /** Per-resource grants. Omit to leave actions enabled. */
  permissions?: TPermissions;
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
  TPermissions extends PermissionsServer = PermissionsServer,
> = AgentChatServer<TSpec> &
  AgentBuilderServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCapabilities> & {
    catalog?: TCatalog;
    sessions?: TSessions;
    metrics?: TMetrics;
    schedules?: TSchedules;
    permissions?: TPermissions;
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
  TPermissions extends PermissionsServer = PermissionsServer,
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
    TSchedules,
    TPermissions
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
  TSchedules,
  TPermissions
> {
  const builder: AgentBuilderServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCapabilities> = {
    getCapabilities: opts.getCapabilities,
    getModels: opts.getModels,
    getSkills: opts.getSkills,
    getMcp: opts.getMcp,
    ...(opts.getMcpConnector === undefined ? {} : { getMcpConnector: opts.getMcpConnector }),
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
    TSchedules,
    TPermissions
  > = {
    ...opts.chatServer,
    ...builder,
    ...(opts.catalog != null ? { catalog: opts.catalog } : {}),
    ...(opts.sessions != null ? { sessions: opts.sessions } : {}),
    ...(opts.metrics != null ? { metrics: opts.metrics } : {}),
    ...(opts.schedules != null ? { schedules: opts.schedules } : {}),
    ...(opts.permissions != null ? { permissions: opts.permissions } : {}),
  };
  return server;
}
