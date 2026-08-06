/**
 * FE-owned AgentUIServer contract.
 *
 * Rule: only methods/fields our UI calls or the runtime invokes.
 * Hosts extend via `T extends Base` for system-specific extras.
 *
 * The runtime will accept `AgentChatServer` instead of gateway clients.
 */

// ---------------------------------------------------------------------------
// Catalog — picker / library rows (SDK-minimal; host extends via generics)
// ---------------------------------------------------------------------------

/** Model picker row. Host extends for apiModel, modelId, pricing, etc. */
export interface ModelSelection {
  name: string;
  provider: string;
  /** When non-empty, UI shows a reasoning-effort picker beside the model selector. */
  reasoningEfforts?: string[];
}

/** Skill picker row. Host extends for fqn, preload, etc. */
export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
}

/** MCP picker row. Host extends for type, enableTools, url, etc. */
export interface ConnectorState {
  id: string;
  name: string;
  description?: string;
}

/** Agents library row — UI shows name only. Host extends for metadata. */
export interface AgentLibraryEntry {
  name: string;
}

export type SearchAgentsParams = {
  query?: string;
  limit?: number;
  offset?: number;
};

// ---------------------------------------------------------------------------
// Mounts — neutral SDK base (host extends with backend-specific fields)
// ---------------------------------------------------------------------------

/** Skill mount base written to AgentSpec.skills[]. Host extends for fqn, preload, etc. */
export interface SkillMount {
  id: string;
  name: string;
}

/** MCP server mount base written to AgentSpec.mcpServers[]. Host extends for type, enableTools, etc. */
export interface McpServerMount {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// AgentSpec — each nested field + the spec itself are host-extendable
// ---------------------------------------------------------------------------

export interface ModelParams {
  maxTokens?: number;
  reasoningEffort?: string;
}

/** Model written to AgentSpec.model. Host extends for provider extras, etc. */
export interface Model<TParams extends ModelParams = ModelParams> {
  name: string;
  params?: TParams;
}

/**
 * SDK-owned agent definition — fields the FE reads/writes.
 *
 * - Nested slots are generic: host widens `Model` / `SkillMount` / `McpServerMount`.
 * - The spec itself is extendable: `interface TfySpec extends AgentSpec<...> { instructions?: string }`.
 *
 * @example
 * ```ts
 * interface TfyModelParams extends ModelParams { temperature?: number }
 * interface TfyModel extends Model<TfyModelParams> {}
 * interface TfySkillMount extends SkillMount { fqn: string; preload: boolean }
 * interface TfyMcpMount extends McpServerMount { type: string; enableTools: string[] }
 *
 * interface TfySpec extends AgentSpec<TfyModel, TfySkillMount, TfyMcpMount> {
 *   instructions?: string;
 *   config?: RuntimeConfig;
 * }
 * ```
 */
export interface AgentSpec<
  TModel extends Model = Model,
  TSkill extends SkillMount = SkillMount,
  TMcp extends McpServerMount = McpServerMount,
> {
  model: TModel;
  skills?: TSkill[];
  mcpServers?: TMcp[];
}

// ---------------------------------------------------------------------------
// Session — plain DTO, generic in TSpec so host's spec type flows through
// ---------------------------------------------------------------------------

export interface Session<TSpec extends AgentSpec = AgentSpec> {
  id: string;
  title?: string;
  agentName?: string;
  agentSpec?: TSpec;
  /** true → mutable builder + updateSession(spec) allowed. */
  isMutable: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionRequest<TSpec extends AgentSpec = AgentSpec> {
  agentName?: string;
  agentSpec?: TSpec;
}

export interface UpdateSessionRequest<TSpec extends AgentSpec = AgentSpec> {
  sessionId: string;
  agentSpec?: TSpec;
  title?: string;
}

// ---------------------------------------------------------------------------
// Pagination
// ---------------------------------------------------------------------------

export interface TokenPagination {
  nextPageToken?: string;
  previousPageToken?: string;
  limit: number;
}

export interface PageResult<T, R = unknown> {
  data: T[];
  response: R;
  hasNextPage(): boolean;
  getNextPage(): Promise<PageResult<T, R>>;
}

export type ListSessionsOrder = 'asc' | 'desc';

export type PageParams = {
  limit?: number;
  order?: ListSessionsOrder;
  pageToken?: string;
};

export interface ListSessionsParams extends PageParams {
  agentName?: string;
}

export interface ListSessionsResponse<
  TSpec extends AgentSpec = AgentSpec,
  TSession extends Session<TSpec> = Session<TSpec>,
> {
  data: TSession[];
  pagination: TokenPagination;
}

export type PreviousTurnIdInput = 'auto' | string;

// ---------------------------------------------------------------------------
// Turn input / state — what runtime sends and reads
// ---------------------------------------------------------------------------

export type UserMessageContent =
  string | Array<{ type: 'text'; text: string } | { type: 'file'; [key: string]: unknown }>;

export interface UserMessage {
  type: 'user.message';
  content: UserMessageContent;
}

export type ApprovalDecision = { status: 'allow' } | { status: 'deny'; reason?: string };

export interface UserToolApprovalEvent {
  type: 'user.tool_approval';
  threadId: string;
  toolCallId: string;
  approval: ApprovalDecision;
}

export interface UserToolResponseEvent {
  type: 'user.tool_response';
  threadId: string;
  toolCallId: string;
  content: string;
}

export type TurnInputItem = UserMessage | UserToolApprovalEvent | UserToolResponseEvent;

export type TurnState =
  | { status: 'running' }
  | {
      status: 'done';
      output?: unknown;
      requiredActions?: unknown[];
      completedAt: string;
    }
  | { status: 'cancelled'; reason: string; completedAt: string }
  | { status: 'error'; message: string; completedAt: string };

export interface Turn {
  id: string;
  sessionId: string;
  previousTurnId?: string;
  input?: TurnInputItem[];
  state: TurnState;
  createdAt: string;
}

export interface ListTurnsResponse<TTurn extends Turn = Turn> {
  data: TTurn[];
  pagination: TokenPagination;
}

// ---------------------------------------------------------------------------
// Stream / events — opaque; host narrows via generics
// ---------------------------------------------------------------------------

export type TurnStreamingEvent = { type: string; [key: string]: unknown };

export interface TurnStreamData<TStreamEvent extends TurnStreamingEvent = TurnStreamingEvent> {
  sequenceNumber: number;
  event: TStreamEvent;
}

export type SessionEvent = { type: string; [key: string]: unknown };

export interface SessionEventItem {
  turnId: string;
  event: SessionEvent;
}

export interface ListSessionEventsResponse<TEvent extends SessionEventItem = SessionEventItem> {
  data: TEvent[];
  pagination: TokenPagination;
}

// ---------------------------------------------------------------------------
// Server ports — flat methods, no session-with-methods objects
// ---------------------------------------------------------------------------

/**
 * Chat / session port — the runtime calls these.
 *
 * All session ops are flat (sessionId param). No gateway client dependency.
 * `createTrueFoundryServer` is one possible implementation (TFY adapter).
 *
 * TSpec flows through Session, CreateSessionRequest, UpdateSessionRequest
 * so the host's extended spec is type-safe end to end.
 */
export interface AgentChatServer<
  TSpec extends AgentSpec = AgentSpec,
  TSession extends Session<TSpec> = Session<TSpec>,
  TCreate extends CreateSessionRequest<TSpec> = CreateSessionRequest<TSpec>,
  TList extends ListSessionsParams = ListSessionsParams,
  TUpdate extends UpdateSessionRequest<TSpec> = UpdateSessionRequest<TSpec>,
  TTurn extends Turn = Turn,
  TEvent extends SessionEventItem = SessionEventItem,
  TStreamEvent extends TurnStreamingEvent = TurnStreamingEvent,
> {
  createSession(req: TCreate): Promise<TSession>;
  listSessions(req?: TList): Promise<PageResult<TSession, ListSessionsResponse<TSpec, TSession>>>;
  getSession(req: { sessionId: string }): Promise<TSession>;
  updateSession(req: TUpdate): Promise<TSession>;

  createTurn(req: {
    sessionId: string;
    input?: TurnInputItem[];
    previousTurnId?: PreviousTurnIdInput;
  }): AsyncIterable<TurnStreamData<TStreamEvent>>;

  cancelSession(req: { sessionId: string }): Promise<void>;
  /** Deletes a session; used by the session list Delete control. */
  deleteSession?(req: { sessionId: string }): Promise<void>;

  listTurns(req: {
    sessionId: string;
    limit?: number;
    pageToken?: string;
  }): Promise<PageResult<TTurn, ListTurnsResponse<TTurn>>>;
  getTurn(req: { sessionId: string; turnId: string }): Promise<TTurn>;
  listEvents(req: {
    sessionId: string;
    pageToken?: string;
    lastTurnId?: string;
    limit?: number;
  }): Promise<PageResult<TEvent, ListSessionEventsResponse<TEvent>>>;

  subscribeToTurn?(req: {
    sessionId: string;
    turnId: string;
    afterSequenceNumber?: number;
  }): AsyncIterable<TurnStreamData<TStreamEvent>>;

  downloadSandboxFile?(sandboxId: string, req: { path: string }): Promise<unknown>;
}

/**
 * Builder catalog + persist port — atoms call these.
 *
 * Generics let hosts type their catalog rows richer than SDK base.
 */
export interface AgentBuilderServer<
  TSpec extends AgentSpec = AgentSpec,
  TModel extends ModelSelection = ModelSelection,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSave = unknown,
> {
  getModels(): Promise<TModel[]>;
  getSkills(): Promise<TSkill[]>;
  getMcp(): Promise<TMcp[]>;
  searchAgents(req?: SearchAgentsParams): Promise<TAgent[]>;
  saveAgent(req: { agentName: string; agentSpec: TSpec }): Promise<TSave>;
  deleteAgent?(req: { agentName: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Catalog management — FE-minimal settings DTOs (host extends via generics)
// ---------------------------------------------------------------------------

/**
 * Provider type id. Reserved literal: `"custom"` for user-defined providers;
 * any other string is a builtin (e.g. `"openai"`, `"anthropic"`).
 *
 * Note: `string | "custom"` is useless in TypeScript (`"custom"` ⊆ `string`),
 * so this stays `string` and `"custom"` is a documented convention.
 */
export type ProviderType = string;

/**
 * Model row — form "Model ID" + "Display name".
 * Host extends for properties, etc.
 */
export interface ModelEntry {
  id: string;
  name: string;
}

/**
 * Write config for create/update (custom form + catalog "Save key").
 * Host extends. `baseUrl` present iff `type === "custom"`.
 */
export interface ModelProviderConfigBase<TModel extends ModelEntry = ModelEntry> {
  type: ProviderType;
  name: string;
  /** Present iff `type === "custom"`. */
  baseUrl?: string;
  apiKey: string;
  models: TModel[];
}

/**
 * Configured provider card (list/read). No raw `apiKey`.
 * Host extends for apiKeySet, timestamps, etc.
 */
export interface ModelProviderBase<TModel extends ModelEntry = ModelEntry> {
  id: string;
  type: ProviderType;
  name: string;
  /** Present iff `type === "custom"`. */
  baseUrl?: string;
  models: TModel[];
}

/**
 * Discovery-only catalog provider (AVAILABLE list).
 * `type` must not be `"custom"` — custom providers use the custom form.
 * Host extends for richer model rows.
 */
export interface ModelProviderCatalogEntry<TModel extends ModelEntry = ModelEntry> {
  type: ProviderType;
  name: string;
  models: TModel[];
}

/** Create — no `id`; server assigns it. Catalog path = entry + apiKey. */
export type CreateModelProviderRequest<TModel extends ModelEntry = ModelEntry> = ModelProviderConfigBase<TModel>;

/** Update — `id` required. */
export type UpdateModelProviderRequest<TModel extends ModelEntry = ModelEntry> = ModelProviderConfigBase<TModel> & {
  id: string;
};

export interface ModelCatalogServer<
  TModel extends ModelEntry = ModelEntry,
  TProvider extends ModelProviderBase<TModel> = ModelProviderBase<TModel>,
  TCatalogProvider extends ModelProviderCatalogEntry<TModel> = ModelProviderCatalogEntry<TModel>,
  TCreate extends CreateModelProviderRequest<TModel> = CreateModelProviderRequest<TModel>,
  TUpdate extends UpdateModelProviderRequest<TModel> = UpdateModelProviderRequest<TModel>,
> {
  getModelProviderCatalog(): Promise<TCatalogProvider[]>;
  listModelProviders(): Promise<TProvider[]>;
  createModelProvider(req: TCreate): Promise<TProvider>;
  /** Full replace update keyed by provider `id`. */
  updateModelProvider(req: TUpdate): Promise<TProvider>;
  deleteModelProvider?(req: { id: string }): Promise<void>;
}

/** Tool row on a connector detail. Host extends for schemas, etc. */
export interface ToolBase {
  id: string;
  name: string;
  description: string;
}

/** Strict auth type id. Hosts widen branches via intersection + re-union. */
export type ConnectorAuthType = 'oauth' | 'apiKey' | 'none';

// Write (create/update) — export branches so hosts can intersect extras
export type ConnectorAuthOAuth = { type: 'oauth'; authUrl?: string };
export type ConnectorAuthApiKey = {
  type: 'apiKey';
  apiKey?: string;
  headerName?: string;
};
export type ConnectorAuthNone = { type: 'none' };
export type ConnectorAuth = ConnectorAuthOAuth | ConnectorAuthApiKey | ConnectorAuthNone;

// Public (list/detail) — no secrets; oauth requires authUrl
export type ConnectorAuthPublicOAuth = { type: 'oauth'; authUrl: string };
export type ConnectorAuthPublicApiKey = {
  type: 'apiKey';
  headerName?: string;
};
export type ConnectorAuthPublicNone = { type: 'none' };
export type ConnectorAuthPublic = ConnectorAuthPublicOAuth | ConnectorAuthPublicApiKey | ConnectorAuthPublicNone;

/**
 * MCP / connector create-edit config. Host extends for extra fields, etc.
 */
export interface ConnectorConfigBase<TAuth extends ConnectorAuth = ConnectorAuth> {
  name: string;
  url: string;
  auth: TAuth;
}

/**
 * Connected connector row (settings/connectors). No raw `apiKey` or tools.
 * Tools are fetched separately with `getToolsByConnectorId`.
 * Host extends.
 */
export interface ConnectorBase<TAuth extends ConnectorAuthPublic = ConnectorAuthPublic> {
  id: string;
  name: string;
  description: string;
  url: string;
  auth: TAuth;
  /** When true, UI should not show Disconnect. */
  requiresAuth: boolean;
  authenticated: boolean;
}

/** Discovery catalog entry for "+ Add MCP server". Host extends. */
export interface ConnectorCatalogEntry<TAuth extends ConnectorAuthPublic = ConnectorAuthPublic> {
  id: string;
  name: string;
  description?: string;
  url: string;
  auth: TAuth;
}

/** Create connector — no `id`; server assigns it. Host extends. */
export type CreateConnectorRequest<TAuth extends ConnectorAuth = ConnectorAuth> = ConnectorConfigBase<TAuth>;

/** Update connector — `id` required. Host extends. */
export type UpdateConnectorRequest<TAuth extends ConnectorAuth = ConnectorAuth> = ConnectorConfigBase<TAuth> & {
  id: string;
};

export interface AuthenticateConnectorRequest {
  id: string;
  /** OAuth callback page owned by the host application. */
  redirectURL?: string;
}

export interface ConnectorAuthenticationResult<TConnector extends ConnectorBase = ConnectorBase> {
  connector?: TConnector;
  status?: string;
  authorization_endpoint?: string;
}

export interface ConnectorCatalogServer<
  TTool extends ToolBase = ToolBase,
  TAuthWrite extends ConnectorAuth = ConnectorAuth,
  TAuthPublic extends ConnectorAuthPublic = ConnectorAuthPublic,
  TConnector extends ConnectorBase<TAuthPublic> = ConnectorBase<TAuthPublic>,
  TCatalogEntry extends ConnectorCatalogEntry<TAuthPublic> = ConnectorCatalogEntry<TAuthPublic>,
  TCreate extends CreateConnectorRequest<TAuthWrite> = CreateConnectorRequest<TAuthWrite>,
  TUpdate extends UpdateConnectorRequest<TAuthWrite> = UpdateConnectorRequest<TAuthWrite>,
> {
  getConnectorCatalog(): Promise<TCatalogEntry[]>;
  listConnectors(req?: { query?: string }): Promise<TConnector[]>;
  getToolsByConnectorId(req: { id: string }): Promise<TTool[]>;
  createConnector(req: TCreate): Promise<TConnector>;
  /** Full replace update keyed by connector `id`. */
  updateConnector(req: TUpdate): Promise<TConnector>;
  /**
   * Start connector auth (e.g. OAuth).
   * May return a connector (already authenticated / with `auth.authUrl`) or a
   * result carrying `authorization_endpoint` for the popup flow.
   */
  authenticateConnector(
    req: AuthenticateConnectorRequest,
  ): Promise<TConnector | ConnectorAuthenticationResult<TConnector>>;
  /** Clear connector auth. */
  disconnectConnector(req: { id: string }): Promise<TConnector>;
  deleteConnector?(req: { id: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Skills catalog — FE-minimal settings DTOs (host extends via generics)
// ---------------------------------------------------------------------------

/** Skill row shown in settings/skills (list + delete). Host extends for fqn, etc. */
export interface SkillBase {
  id: string;
  name: string;
  description: string;
}

export interface RegistrySkill extends SkillBase {
  /** `SkillCatalogEntry.id` this skill was created from. */
  catalogId: string;
}

export interface GithubSkill extends SkillBase {}

export type DefinedSkill = RegistrySkill | GithubSkill;

/** Git source fields shared by catalog entries and create requests. */
export interface SkillConfigBase {
  name: string;
  description: string;
  repoURL: string;
  path: string;
  ref: string;
}

/** Catalog row for "Available" skills. Selecting one defines it in the host DB. */
export interface SkillCatalogEntry extends SkillConfigBase {
  id: string;
}

/** Create-skill base. Hosts may intersect extra fields and re-union. */
export interface CreateSkillRequestBase extends SkillConfigBase {}

export interface SelectRegistrySkillRequest extends CreateSkillRequestBase {
  /** `SkillCatalogEntry.id`, persisted so the created skill links back to it. */
  catalogId: string;
}

export interface ImportGithubSkillRequest extends CreateSkillRequestBase {}

export type CreateSkillRequest = SelectRegistrySkillRequest | ImportGithubSkillRequest;

export interface SkillCatalogServer<
  TSkill extends SkillBase = SkillBase,
  TCatalogEntry extends SkillCatalogEntry = SkillCatalogEntry,
  TCreate extends CreateSkillRequest = CreateSkillRequest,
> {
  getSkillCatalog(): Promise<TCatalogEntry[]>;
  listSkills(req?: { query?: string }): Promise<TSkill[]>;
  createSkill(req: TCreate): Promise<TSkill>;
  /**
   * Removes the skill from the host DB. A registry skill (has `catalogId`) stays
   * in the catalog and becomes selectable again; a github skill is gone for good.
   */
  deleteSkill?(req: { id: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Sandbox providers catalog — public rows omit credentials; writes accept them
// ---------------------------------------------------------------------------

/** Mutable sandbox provider settings shared by catalog rows, create, and update. */
export interface SandboxProviderConfig {
  snapshotName: string;
  execTimeoutMs: number;
  autoStopIntervalInMinutes: number;
  autoArchiveIntervalInMinutes: number;
  autoDeleteIntervalInMinutes: number;
}

export interface SandboxProviderCatalogEntry extends SandboxProviderConfig {
  id: string;
  name: string;
  type: string;
}

/**
 * Connected sandbox provider row (settings/sandboxes). No raw `apiKey`.
 * Includes last-saved config so update forms can show previous values.
 */
export interface SandboxProviderBase extends SandboxProviderConfig {
  id: string;
  name: string;
  catalogId: string;
  isConnected: boolean;
}

/**
 * Create — catalog identity + config + apiKey.
 * `catalogId` is `SandboxProviderCatalogEntry.id`; the server assigns the provider `id`.
 */
export interface CreateSandboxProviderRequest extends SandboxProviderConfig {
  catalogId: string;
  name: string;
  type: string;
  apiKey: string;
}

/** Update — full replace of config keyed by sandbox provider `id`. */
export interface UpdateSandboxProviderRequest extends SandboxProviderConfig {
  id: string;
  /** Omit to keep the existing key; send a value to rotate. */
  apiKey?: string;
}

export interface SandboxCatalogServer<
  TProvider extends SandboxProviderBase = SandboxProviderBase,
  TCatalogEntry extends SandboxProviderCatalogEntry = SandboxProviderCatalogEntry,
  TCreate extends CreateSandboxProviderRequest = CreateSandboxProviderRequest,
  TUpdate extends UpdateSandboxProviderRequest = UpdateSandboxProviderRequest,
> {
  getSandboxProviderCatalog(): Promise<TCatalogEntry[]>;
  listSandboxProviders(req?: { query?: string }): Promise<TProvider[]>;
  createSandboxProvider(req: TCreate): Promise<TProvider>;
  updateSandboxProvider(req: TUpdate): Promise<TProvider>;
  deleteSandboxProvider?(req: { id: string }): Promise<void>;
}

/**
 * Settings management aggregate — modelCatalog + connectorCatalog + optional
 * skill and sandbox catalogs.
 * Hosts may pass the whole object to an app shell, or a focused sub-port to a page.
 */
export interface CatalogServer<
  TModelCatalog extends ModelCatalogServer = ModelCatalogServer,
  TConnectorCatalog extends ConnectorCatalogServer = ConnectorCatalogServer,
  TSkillCatalog extends SkillCatalogServer = SkillCatalogServer,
  TSandboxCatalog extends SandboxCatalogServer = SandboxCatalogServer,
> {
  modelCatalog: TModelCatalog;
  connectorCatalog: TConnectorCatalog;
  /** Optional — omit when the host has no skills settings surface. */
  skillCatalog?: TSkillCatalog;
  /** Optional — omit when the host has no sandboxes settings surface. */
  sandboxCatalog?: TSandboxCatalog;
}

/** Combined port: runtime (chat) + atoms (builder) + optional settings catalog. */
export type AgentUIServer<
  TSpec extends AgentSpec = AgentSpec,
  TSession extends Session<TSpec> = Session<TSpec>,
  TCreate extends CreateSessionRequest<TSpec> = CreateSessionRequest<TSpec>,
  TList extends ListSessionsParams = ListSessionsParams,
  TUpdate extends UpdateSessionRequest<TSpec> = UpdateSessionRequest<TSpec>,
  TTurn extends Turn = Turn,
  TEvent extends SessionEventItem = SessionEventItem,
  TStreamEvent extends TurnStreamingEvent = TurnStreamingEvent,
  TModel extends ModelSelection = ModelSelection,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSave = unknown,
  TCatalog extends CatalogServer = CatalogServer,
> = AgentChatServer<TSpec, TSession, TCreate, TList, TUpdate, TTurn, TEvent, TStreamEvent> &
  AgentBuilderServer<TSpec, TModel, TSkill, TMcp, TAgent, TSave> & {
    catalog?: TCatalog;
  };
