import type {
  AgentBuilderServer,
  AgentChatServer,
  AgentLibraryEntry,
  AgentSkill,
  AgentSpec,
  AgentUIServer,
  CatalogServer,
  ConnectorState,
  CreateSessionRequest,
  ListSessionsParams,
  ModelSelection,
  SearchAgentsParams,
  Session,
  SessionEventItem,
  Turn,
  TurnStreamingEvent,
  UpdateSessionRequest,
} from './types.js';

export type CreateTrueFoundryServerOptions<
  TSpec extends AgentSpec = AgentSpec,
  TModel extends ModelSelection = ModelSelection,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSave = unknown,
  TCatalog extends CatalogServer = CatalogServer,
> = {
  /** Chat port — e.g. from `@truefoundry/agent-server-adapter`. */
  chatServer: AgentChatServer<TSpec>;
  getModels: () => Promise<TModel[]>;
  getSkills: () => Promise<TSkill[]>;
  getMcp: () => Promise<TMcp[]>;
  searchAgents: (req?: SearchAgentsParams) => Promise<TAgent[]>;
  saveAgent: (req: { agentName: string; agentSpec: TSpec }) => Promise<TSave>;
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
  TSave = unknown,
  TCatalog extends CatalogServer = CatalogServer,
> = AgentUIServer<
  TSpec,
  Session<TSpec>,
  CreateSessionRequest<TSpec>,
  ListSessionsParams,
  UpdateSessionRequest<TSpec>,
  Turn,
  SessionEventItem,
  TurnStreamingEvent,
  TModel,
  TSkill,
  TMcp,
  TAgent,
  TSave,
  TCatalog
>;

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
  TSave = unknown,
  TCatalog extends CatalogServer = CatalogServer,
>(
  opts: CreateTrueFoundryServerOptions<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCatalog>,
): TrueFoundryServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCatalog> {
  const builder: AgentBuilderServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave> = {
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

  return {
    ...opts.chatServer,
    ...builder,
    ...(opts.catalog != null ? { catalog: opts.catalog } : {}),
  } as TrueFoundryServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave, TCatalog>;
}
