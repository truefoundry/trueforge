import type {
  AgentBuilderCapabilitiesResponse,
  AgentBuilderServer,
  AgentChatServer,
  AgentLibraryEntry,
  AgentSkill,
  AgentSpec,
  CatalogServer,
  ConnectorState,
  ModelSelection,
  SaveAgentRequest,
  SaveAgentResult,
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
> = {
  /** Chat port — e.g. from `@truefoundry/agent-server-adapter`. */
  chatServer: AgentChatServer<TSpec>;
  getCapabilities: () => Promise<TCapabilities>;
  getModels: () => Promise<TModel[]>;
  getSkills: () => Promise<TSkill[]>;
  getMcp: () => Promise<TMcp[]>;
  searchAgents: (req?: SearchAgentsParams) => Promise<TAgent[]>;
  saveAgent: (req: SaveAgentRequest<TSpec>) => Promise<TSave>;
  deleteAgent?: (req: { agentName: string }) => Promise<void>;
  /** Settings catalog (models + connectors). Optional. */
  catalog?: TCatalog;
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
> = AgentChatServer<TSpec> &
  AgentBuilderServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCapabilities> & {
    catalog?: TCatalog;
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
>(
  opts: CreateTrueFoundryServerOptions<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCatalog, TCapabilities>,
): TrueFoundryServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCatalog, TCapabilities> {
  const builder: AgentBuilderServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCapabilities> = {
    getCapabilities: opts.getCapabilities,
    getModels: opts.getModels,
    getSkills: opts.getSkills,
    getMcp: opts.getMcp,
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

  const server: TrueFoundryServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCatalog, TCapabilities> = {
    ...opts.chatServer,
    ...builder,
    ...(opts.catalog != null ? { catalog: opts.catalog } : {}),
  };
  return server;
}
