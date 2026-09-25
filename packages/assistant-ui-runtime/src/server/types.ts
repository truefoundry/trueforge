/**
 * FE-owned AgentUIServer contract.
 *
 * Rule: only methods/fields the runtime or UI invokes.
 * Hosts extend via `T extends Base` for system-specific extras.
 * No dependency on trueforge-gateway-sdk.
 */

import type { ActionRequiredEvent, SessionEventItem, TurnEvent, TurnStreamData } from './events.js';

// ---------------------------------------------------------------------------
// Catalog — selector rows (SDK-minimal; host extends via generics)
// ---------------------------------------------------------------------------
export interface ProviderEntry {
  name: string;
  logo?: string;
}

export interface ModelProperties {
  reasoningEfforts?: string[];
  contextLength?: number;
  maxOutputTokens?: number;
}

/** Model selector row. Host extends for apiModel, modelId, etc. */
export interface ModelSelectorEntry<
  TProvider extends ProviderEntry = ProviderEntry,
  TProperties extends ModelProperties = ModelProperties,
> {
  name: string;
  id: string;
  provider: TProvider;
  properties: TProperties;
}

/** Skill selector row. Host extends for fqn, preload, etc. */
export interface SkillSelectorEntry {
  id: string;
  name: string;
  description?: string;
}

/** MCP connector selector row. Host extends for type, enableTools, url, etc. */
export interface ConnectorSelectorEntry {
  id: string;
  name: string;
  description?: string;
  /** When true, the connector must be authenticated before use. Omitted when the host does not report auth. */
  requiresAuth?: boolean;
  /** When true, the connector is already authenticated. Omitted when the host does not report auth. */
  authenticated?: boolean;
}

/** Who created a resource. Optional on list DTOs when the host does not track creators. */
export interface CreatedBySubject {
  subjectId: string;
  subjectType: string;
  subjectDisplayName: string;
}

/** Agent selector row. Host extends for metadata; `agentSpec` enables Edit. */
export interface AgentSelectorEntry {
  name: string;
  /** Stable id when distinct from display `name`. Falls back to `name` when omitted. */
  agentId?: string;
  /** Published-agent description; not part of the executable agent spec. */
  description?: string;
  /** Published agent spec — required for Edit; optional for Try-only hosts. */
  agentSpec?: AgentSpec;
  /** Creator when the host persists one; omit to hide Created-by UI. */
  createdBySubject?: CreatedBySubject;
}

export interface SearchAgentSelectorParams {
  query?: string;
  limit?: number;
  offset?: number;
}

// ---------------------------------------------------------------------------
// Mounts — neutral SDK base (host extends with backend-specific fields)
// ---------------------------------------------------------------------------

/**
 * Mounts written to AgentSpec.skills[] / AgentSpec.mcpServers[].
 *
 * These are opaque to the runtime — it stores and forwards them but never reads
 * a field, and the backend owns the shape (the gateway identifies a skill by
 * `fqn`, with no `id` or `name` anywhere). So the base constrains only that a
 * mount is an object; hosts intersect their concrete mount type over it, as
 * `TfySkillMount` / `TfyMcpServerMount` do in the gateway adapter.
 *
 * Naming a field here would not just be unread, it would be wrong: a base with
 * required fields rejects the backend's own payloads, and one with only optional
 * fields is a weak type, which TypeScript rejects for a source that shares no
 * property with it — the gateway's registry skill shares none.
 */
export type SkillMount = object;

export type McpServerMount = object;

// ---------------------------------------------------------------------------
// AgentSpec — model / skills / mcpServers are type params; host widens the rest
// ---------------------------------------------------------------------------

export interface ModelParams {
  maxTokens?: number;
  reasoningEffort?: string;
  temperature?: number;
  topP?: number;
  topK?: number;
  parallelToolCalls?: boolean;
}

export interface Model {
  name: string;
  params?: ModelParams;
}

export interface AgentCapabilityConfig {
  enabled?: boolean;
}

export interface AgentSandboxConfig extends AgentCapabilityConfig {
  fileDownloads?: boolean;
}

export interface AgentInputTokensCompactionTrigger {
  type: 'input_tokens';
  value: number;
}

export interface AgentCompactionConfig extends AgentCapabilityConfig {
  trigger?: AgentInputTokensCompactionTrigger;
}

export interface AgentContextManagementConfig {
  compaction?: AgentCompactionConfig;
  largeToolResponse?: AgentCapabilityConfig;
}

export interface AgentRuntimeConfig {
  iterationLimit?: number;
  sandbox?: AgentSandboxConfig;
  contextManagement?: AgentContextManagementConfig;
  generativeUi?: AgentCapabilityConfig;
  dynamicSubAgents?: AgentCapabilityConfig;
  askUserQuestions?: AgentCapabilityConfig;
  webSearch?: AgentCapabilityConfig;
}

/**
 * SDK-owned agent definition — fields the FE reads/writes.
 * Host widens `model` / `skills` / `mcpServers` / `config` via type params,
 * and adds extra fields via `TSpec extends AgentSpec<...>`.
 */
export interface AgentSpec<
  TModel extends Model = Model,
  TSkill extends SkillMount = SkillMount,
  TMcp extends McpServerMount = McpServerMount,
  TConfig extends AgentRuntimeConfig = AgentRuntimeConfig,
> {
  model: TModel;
  skills?: TSkill[];
  mcpServers?: TMcp[];
  config?: TConfig;
  instructions?: string;
  variables?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Session — plain DTO, generic in TSpec so host's spec type flows through
// ---------------------------------------------------------------------------

export interface Session<TSpec extends AgentSpec = AgentSpec> {
  id: string;
  title?: string | null;
  agentName?: string | null;
  agentSpec?: TSpec;
  /** true → mutable builder + updateSession(spec) allowed. */
  isMutable: boolean;
  /** When true, any subject in the tenant may read this session by id. */
  shared?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionRequest<TSpec extends AgentSpec = AgentSpec> {
  agentName?: string;
  agentSpec?: TSpec;
  title?: string;
}

export interface UpdateSessionRequest<TSpec extends AgentSpec = AgentSpec> {
  sessionId: string;
  agentSpec?: TSpec;
  title?: string;
  /** When true, any subject in the tenant may read this session by id. */
  shared?: boolean;
}

// ---------------------------------------------------------------------------
// Pagination — flat token-based (no Page objects with methods)
// ---------------------------------------------------------------------------

export interface ListResult<T> {
  data: T[];
  nextPageToken?: string;
}

export type ListSessionsOrder = 'asc' | 'desc';

export interface PageParams {
  limit?: number;
  order?: ListSessionsOrder;
  pageToken?: string;
}

export interface ListSessionsParams extends PageParams {
  /** Host-owned agent identity filter. Omit for all sessions (current user). */
  agentId?: string;
  /**
   * When true, only sessions created by the authenticated subject.
   * Omit to include managed-agent visibility where the host supports it.
   */
  createdByMe?: boolean;
  /** Inclusive lower bound on session activity (ISO-8601). */
  startTimestamp?: string;
  /** Inclusive upper bound on session activity (ISO-8601). */
  endTimestamp?: string;
}

export type PreviousTurnIdInput = string;

// ---------------------------------------------------------------------------
// Turn input / state — what runtime sends and reads
// ---------------------------------------------------------------------------

export type UserMessageContent =
  string | ({ type: 'text'; text: string } | { type: 'file'; name: string; data: string })[];

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

export interface TurnStateRunning {
  status: 'running';
}

/**
 * Aggregated token metrics on a finished turn (`turn.done.state.metrics`).
 * Host maps wire snake_case (`total_input_tokens`, …) → camelCase here.
 */
export interface TurnDoneMetrics {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalReasoningTokens: number;
}

export interface TurnStateDone {
  status: 'done';
  output?: unknown;
  requiredActions?: ActionRequiredEvent[];
  completedAt: string;
  /** Present when the host reports per-turn token totals. */
  metrics?: TurnDoneMetrics;
}

export interface TurnStateCancelled {
  status: 'cancelled';
  reason: string;
  completedAt: string;
}

export interface TurnStateError {
  status: 'error';
  message: string;
  completedAt: string;
}

export type TurnState = TurnStateRunning | TurnStateDone | TurnStateCancelled | TurnStateError;

/** Plain turn DTO — no methods. */
export interface Turn {
  id: string;
  sessionId: string;
  previousTurnId?: string | null;
  input?: TurnInputItem[];
  state: TurnState;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Server ports — flat methods, no session-with-methods objects
// ---------------------------------------------------------------------------

/**
 * Chat / session port — the runtime calls these.
 *
 * All session ops are flat (sessionId param). No gateway client dependency.
 * `createTrueForgeServer` is one possible implementation (TFY adapter).
 */
export interface AgentChatServer<
  TSpec extends AgentSpec = AgentSpec,
  TSession extends Session<TSpec> = Session<TSpec>,
  TCreate extends CreateSessionRequest<TSpec> = CreateSessionRequest<TSpec>,
  TList extends ListSessionsParams = ListSessionsParams,
  TUpdate extends UpdateSessionRequest<TSpec> = UpdateSessionRequest<TSpec>,
  TTurn extends Turn = Turn,
> {
  createSession(req: TCreate): Promise<TSession>;
  listSessions(req?: TList): Promise<ListResult<TSession>>;
  getSession(req: { sessionId: string }): Promise<TSession>;
  updateSession(req: TUpdate): Promise<TSession>;

  createTurn(req: {
    sessionId: string;
    input?: TurnInputItem[];
    previousTurnId?: PreviousTurnIdInput;
    abortSignal?: AbortSignal;
    headers?: Record<string, string>;
  }): AsyncIterable<TurnStreamData>;

  cancelSession(req: { sessionId: string }): Promise<void>;
  deleteSession?(req: { sessionId: string }): Promise<void>;
  /**
   * When present, thread-list `rename` persists via this method.
   * Omitted: rename is a no-op (TrueForge Gateway does not persist titles).
   */
  renameSession?(req: { sessionId: string; title: string }): Promise<void>;

  listTurns(req: {
    sessionId: string;
    limit?: number;
    pageToken?: string;
    order?: ListSessionsOrder;
  }): Promise<ListResult<TTurn>>;
  getTurn(req: { sessionId: string; turnId: string }): Promise<TTurn>;
  listEvents(req: {
    sessionId: string;
    pageToken?: string;
    lastTurnId?: string;
    limit?: number;
  }): Promise<ListResult<SessionEventItem>>;

  /** Optional per-turn event listing (hydrate in-flight turn content). */
  listTurnEvents?(req: {
    sessionId: string;
    turnId: string;
    limit?: number;
    pageToken?: string;
    order?: ListSessionsOrder;
  }): Promise<ListResult<TurnEvent>>;

  subscribeToTurn?(req: {
    sessionId: string;
    turnId: string;
    afterSequenceNumber?: number;
    abortSignal?: AbortSignal;
  }): AsyncIterable<TurnStreamData>;

  /**
   * Reads a file the agent wrote inside its sandbox. Hosts whose download route is scoped to a
   * turn resolve the sandbox from `turnId` and ignore `sandboxId`; hosts addressing sandboxes
   * directly use `sandboxId` when the runtime was able to recover it (optional after resume when
   * `sandbox.created` is outside the loaded history window).
   */
  downloadSandboxFile?(req: {
    sessionId: string;
    turnId: string;
    /** Present when a `sandbox.created` event was observed in session history or the live stream. */
    sandboxId?: string;
    path: string;
  }): Promise<Blob>;
}

/** Request body for `AgentBuilderServer.saveAgent`. */
export interface SaveAgentRequest<TSpec extends AgentSpec = AgentSpec> {
  agentName: string;
  /** Published-agent description; hosts may require it when creating an agent. */
  description?: string;
  agentSpec: TSpec;
  intent: 'create' | 'update';
  /** Current mutable session to update atomically with the named agent. */
  sessionId?: string;
}

export interface SaveAgentResult {
  /** Immutable id allocated by the host registry. */
  agentId?: string;
  /** Version id allocated by the host registry for this save. */
  versionId?: string;
  /** Timestamp returned when the active mutable session was updated. */
  sessionUpdatedAt?: string;
}

/** MCP tool row used by the per-agent connector tool selector. */
export interface McpToolSelection {
  id: string;
  name: string;
  description?: string;
}

/**
 * Builder feature flags — atoms gate sandbox / skill / settings surfaces on these.
 */
export interface AgentBuilderCapabilitiesResponse {
  data: {
    sandbox: { enabled: boolean };
    skill: { enabled: boolean; reason?: string };
    settings?: { enabled: boolean };
    webSearch?: { enabled: boolean };
  };
}

/**
 * Builder catalog + persist port — atoms call these.
 * Passed separately from the runtime's chat server.
 */
export interface AgentBuilderServer<
  TSpec extends AgentSpec = AgentSpec,
  TModel extends ModelSelectorEntry = ModelSelectorEntry,
  TSkill extends SkillSelectorEntry = SkillSelectorEntry,
  TMcp extends ConnectorSelectorEntry = ConnectorSelectorEntry,
  TAgent extends AgentSelectorEntry = AgentSelectorEntry,
  TSave = SaveAgentResult,
  TCapabilities extends AgentBuilderCapabilitiesResponse = AgentBuilderCapabilitiesResponse,
  TMcpTool extends McpToolSelection = McpToolSelection,
> {
  getCapabilities(): Promise<TCapabilities>;
  getModels(): Promise<TModel[]>;
  getSkills(): Promise<TSkill[]>;
  getMcp(): Promise<TMcp[]>;
  getMcpConnector?(req: { connectorId: string }): Promise<TMcp>;
  getMcpTools?(req: { connectorId: string }): Promise<TMcpTool[]>;
  searchAgents(req?: SearchAgentSelectorParams): Promise<TAgent[]>;
  saveAgent(req: SaveAgentRequest<TSpec>): Promise<TSave>;
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
  supportedReasoningEfforts?: string[];
  logo?: string;
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
export type ConnectorAuthType = 'dcr' | 'header' | 'none';

// Write (create/update) — export branches so hosts can intersect extras
export interface ConnectorAuthOAuth {
  type: 'dcr';
  authUrl?: string;
}
export interface ConnectorAuthApiKey {
  type: 'header';
  apiKey?: string;
  headerName?: string;
}
export interface ConnectorAuthNone {
  type: 'none';
}
export type ConnectorAuth = ConnectorAuthOAuth | ConnectorAuthApiKey | ConnectorAuthNone;

// Public (list/detail) — no secrets
export interface ConnectorAuthPublicOAuth {
  type: 'dcr';
  authUrl?: string;
}
export interface ConnectorAuthPublicApiKey {
  type: 'header';
  headerName?: string;
}
export interface ConnectorAuthPublicNone {
  type: 'none';
}
export type ConnectorAuthPublic = ConnectorAuthPublicOAuth | ConnectorAuthPublicApiKey | ConnectorAuthPublicNone;

/**
 * MCP / connector create-edit config. Host extends for extra fields, etc.
 */
export interface ConnectorConfigBase<TAuth extends ConnectorAuth = ConnectorAuth> {
  name: string;
  description: string;
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
  logo?: string;
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
  returnTo?: string;
}

export interface ConnectorAuthenticationResult<TConnector extends ConnectorBase = ConnectorBase> {
  connector?: TConnector;
  status?: string;
  authorization_endpoint?: string | undefined;
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
  getConnector(req: { id: string }): Promise<TConnector>;
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

export type GithubSkill = SkillBase;

export type DefinedSkill = RegistrySkill | GithubSkill;

/** Git source fields shared by catalog entries and create requests. */
export interface SkillConfigBase {
  name: string;
  description: string;
  repoURL: string;
  path: string;
  ref: string;
}

export interface SkillCatalogEntry extends SkillConfigBase {
  id: string;
}

/** Create-skill base. Hosts may intersect extra fields and re-union. */
export type CreateSkillRequestBase = SkillConfigBase;

export interface SelectRegistrySkillRequest extends CreateSkillRequestBase {
  /** `SkillCatalogEntry.id`, persisted so the created skill links back to it. */
  catalogId: string;
}

export type ImportGithubSkillRequest = CreateSkillRequestBase;

export type CreateSkillRequest = SelectRegistrySkillRequest | ImportGithubSkillRequest;

export interface SkillCatalogServer<
  TSkill extends SkillBase = SkillBase,
  TCatalogEntry extends SkillCatalogEntry = SkillCatalogEntry,
  TCreate extends CreateSkillRequest = CreateSkillRequest,
> {
  getSkillCatalog(): Promise<TCatalogEntry[]>;
  listSkills(req?: { query?: string }): Promise<TSkill[]>;
  createSkill(req: TCreate): Promise<TSkill>;
  deleteSkill?(req: { id: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Sandbox providers catalog — public rows omit credentials; writes accept them
// ---------------------------------------------------------------------------

/** Discovery catalog row. Hosts extend for provider-specific defaults. */
export interface SandboxCatalogEntry {
  id: string;
  name: string;
  type: string;
}

/**
 * Connected sandbox provider row (settings/sandboxes). No raw `apiKey`.
 * Hosts extend for provider-specific settings shown on update forms.
 */
export interface SandboxBase {
  id: string;
  name: string;
  catalogId: string;
  isConnected: boolean;
}

export interface SandboxSnapshotSyncStatus {
  status: 'pending' | 'ready' | 'failed';
  statusReason?: string | null;
}

export interface SandboxProviderListEntry<TSandbox extends SandboxBase = SandboxBase> {
  data: TSandbox;
  snapshotSyncStatus: SandboxSnapshotSyncStatus;
}

export interface CreateSandboxRequest {
  /** `SandboxCatalogEntry.id` used to create this sandbox provider. */
  catalogId: string;
  name: string;
  type: string;
  apiKey: string;
}

export interface UpdateSandboxRequest {
  id: string;
  /** Omit to keep the existing key; send a value to rotate. */
  apiKey?: string;
}

/** Host-facing aliases (trueforge-ui public names). */
export type SandboxProviderCatalogEntry = SandboxCatalogEntry;
export type SandboxProviderBase = SandboxBase;
export type CreateSandboxProviderRequest = CreateSandboxRequest;
export type UpdateSandboxProviderRequest = UpdateSandboxRequest;

export interface SandboxCatalogServer<
  TProvider extends SandboxBase = SandboxBase,
  TCatalogEntry extends SandboxCatalogEntry = SandboxCatalogEntry,
  TCreate extends CreateSandboxRequest = CreateSandboxRequest,
  TUpdate extends UpdateSandboxRequest = UpdateSandboxRequest,
  TListEntry extends SandboxProviderListEntry<TProvider> = SandboxProviderListEntry<TProvider>,
> {
  getSandboxProviderCatalog(): Promise<TCatalogEntry[]>;
  listSandboxProviders(req?: { query?: string }): Promise<TListEntry[]>;
  createSandboxProvider(req: TCreate): Promise<TProvider>;
  updateSandboxProvider(req: TUpdate): Promise<TProvider>;
  deleteSandboxProvider?(req: { id: string }): Promise<void>;
}

// ---------------------------------------------------------------------------
// Web-search providers catalog — public rows omit credentials; writes accept them
// ---------------------------------------------------------------------------

export interface WebSearchCatalogEntry {
  id: string;
  name: string;
  type: string;
}

/**
 * Connected web-search provider row (settings/web-search). No raw `apiKey`.
 */
export interface WebSearchBase {
  id: string;
  name: string;
  catalogId: string;
  isConnected: boolean;
}

export interface CreateWebSearchRequest {
  /** `WebSearchCatalogEntry.id` used to create this web-search provider. */
  catalogId: string;
  name: string;
  type: string;
  apiKey: string;
}

export interface UpdateWebSearchRequest {
  id: string;
  /** Omit to keep the existing key; send a value to set/rotate. */
  apiKey?: string;
}

/** Host-facing aliases (trueforge-ui public names). */
export type WebSearchProviderCatalogEntry = WebSearchCatalogEntry;
export type WebSearchProviderBase = WebSearchBase;
export type CreateWebSearchProviderRequest = CreateWebSearchRequest;
export type UpdateWebSearchProviderRequest = UpdateWebSearchRequest;

export interface WebSearchCatalogServer<
  TProvider extends WebSearchBase = WebSearchBase,
  TCatalogEntry extends WebSearchCatalogEntry = WebSearchCatalogEntry,
  TCreate extends CreateWebSearchRequest = CreateWebSearchRequest,
  TUpdate extends UpdateWebSearchRequest = UpdateWebSearchRequest,
> {
  getWebSearchProviderCatalog(): Promise<TCatalogEntry[]>;
  listWebSearchProviders(req?: { query?: string }): Promise<TProvider[]>;
  createWebSearchProvider(req: TCreate): Promise<TProvider>;
  updateWebSearchProvider(req: TUpdate): Promise<TProvider>;
}

/** Host-facing selector / compose aliases (trueforge-ui public names). */
export type ModelSelection = ModelSelectorEntry;
export type AgentSkill = SkillSelectorEntry;
export type ConnectorState = ConnectorSelectorEntry;
export type AgentLibraryEntry = AgentSelectorEntry;
export type SearchAgentsParams = SearchAgentSelectorParams;

/**
 * Settings management aggregate — modelCatalog + connectorCatalog + optional
 * skill, sandbox, and web-search catalogs.
 * Hosts may pass the whole object to an app shell, or a focused sub-port to a page.
 */
export interface CatalogServer<
  TModelCatalog extends ModelCatalogServer = ModelCatalogServer,
  TConnectorCatalog extends ConnectorCatalogServer = ConnectorCatalogServer,
  TSkillCatalog extends SkillCatalogServer = SkillCatalogServer,
  TSandboxCatalog extends SandboxCatalogServer = SandboxCatalogServer,
  TWebSearchCatalog extends WebSearchCatalogServer = WebSearchCatalogServer,
> {
  modelCatalog: TModelCatalog;
  connectorCatalog: TConnectorCatalog;
  /** Optional — omit when the host has no skills settings surface. */
  skillCatalog?: TSkillCatalog;
  /** Optional — omit when the host has no sandboxes settings surface. */
  sandboxCatalog?: TSandboxCatalog;
  /** Optional — omit when the host has no web-search settings surface. */
  webSearchCatalog?: TWebSearchCatalog;
}

// ---------------------------------------------------------------------------
// AgentSessions — optional agent-detail shell (Overview + sessions under agent)
// ---------------------------------------------------------------------------

/**
 * Published agent identity + spec for the agent-detail Overview (read-only).
 * Host widens `TSpec` (and may extend this DTO) for mounts / config / extras.
 */
export interface AgentDetail<TSpec extends AgentSpec = AgentSpec> {
  agentId: string;
  /** Display name (e.g. "release-notes-writer"). */
  name: string;
  /** Published-agent description; not part of the executable agent spec. */
  description?: string;
  agentSpec: TSpec;
}

/** Stream vs non-stream bodies for one language on the Use In Code tab. */
export interface CodeSnippetSampleCode {
  stream: string;
  nonStream: string;
}

/**
 * One language row for Use In Code.
 * Host maps wire `sample_code` / `non_stream` → camelCase here.
 */
export interface CodeSnippet<TSample extends CodeSnippetSampleCode = CodeSnippetSampleCode> {
  /** Sidebar label (e.g. "TypeScript"). */
  labelName: string;
  /** Highlighter / tab id (e.g. "typescript"). */
  language: string;
  icon?: string;
  sampleCode: TSample;
}

/**
 * Aggregated session metrics for the sessions list sidebar.
 * Host maps wire snake_case (`total_turns`, `total_cost_in_usd`, …) → camelCase.
 */
export interface SessionListMetrics {
  totalTurns: number;
  totalCostInUsd?: number;
  totalDurationMs: number;
}

/**
 * One row in the Agent Sessions list (left pane).
 *
 * Binding: `agentName` → named / immutable agent; `agentSpec` → mutable / draft.
 * Host may send one, both, or neither depending on how the session was created.
 */
export interface SessionListEntry<TSpec extends AgentSpec = AgentSpec> {
  id: string;
  title?: string | null;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  metrics: SessionListMetrics;
  /** Present when bound to a published (immutable) agent. */
  agentName?: string | null;
  /** Present when bound to a mutable / draft agent spec. */
  agentSpec?: TSpec;
}

/** Params for `AgentSessionsServer.listSessionEvents` (session event timeline). */
export interface ListSessionEventsParams extends Pick<PageParams, 'limit' | 'pageToken'> {
  sessionId: string;
}

/**
 * Optional plug-in for agent-detail UI: Overview, Use In Code, sessions list,
 * and per-session event timeline. Omit `sessions` on `AgentUIServerPort` when
 * the host has no agent-detail surface.
 *
 * Read-only — create/update/delete stay on `AgentChatServer` / `AgentBuilderServer`.
 */
export interface AgentSessionsServer<
  TSpec extends AgentSpec = AgentSpec,
  TDetail extends AgentDetail<TSpec> = AgentDetail<TSpec>,
  TSnippet extends CodeSnippet = CodeSnippet,
  TListEntry extends SessionListEntry<TSpec> = SessionListEntry<TSpec>,
  TList extends ListSessionsParams = ListSessionsParams,
> {
  /** Fetch published agent details by id for the Overview tab. */
  getAgent(req: { agentId: string }): Promise<TDetail>;
  /** Fetch Use In Code snippets for the agent (one row per language). */
  getCodeSnippets(req: { agentId: string }): Promise<TSnippet[]>;
  /**
   * List sessions visible to the current user. Pass `agentId` to scope to one
   * agent; `createdByMe: true` for only sessions they created. Use
   * `startTimestamp` / `endTimestamp` for date filters.
   */
  listSessions(req?: TList): Promise<ListResult<TListEntry>>;
  /**
   * Fetch the session event timeline (right pane). Paginate with `pageToken`
   * until exhausted; rebuild turns from `turn.created` / `turn.done` +
   * nested `TurnEvent`s. Per-turn token metrics live on `turn.done.state.metrics`.
   */
  listSessionEvents(req: ListSessionEventsParams): Promise<ListResult<SessionEventItem>>;
}

// ---------------------------------------------------------------------------
// Schedules — optional schedules listing + CRUD + manual runs (host extends)
// ---------------------------------------------------------------------------

export type ScheduleStatus = 'active' | 'paused';

export type ScheduleRunStatus = 'scheduled' | 'triggered' | 'failed';

export interface Schedule {
  id: string;
  name: string;
  /** Stable agent id (`AgentSelectorEntry.agentId`). */
  agentId: string;
  /** Display name; omit when the host only has `agentId`. */
  agentName?: string;
  task: string;
  cron: string;
  timezone: string;
  status: ScheduleStatus;
  lastRunAt: string | null;
  /** Creator when the host persists one; omit to hide Created-by UI. */
  createdBySubject?: CreatedBySubject;
}

/** Flat schedule-run DTO (ISO-8601 timestamps; host maps from wire Dates). */
export interface ScheduleRun {
  id: string;
  scheduleId: string;
  name: string;
  scheduledFor: string;
  status: ScheduleRunStatus;
  /** Failure reason supplied by the scheduler, when available. */
  reason?: string | null;
  triggeredAt: string | null;
  triggeredBy: string;
}

export interface ListSchedulesParams extends Pick<PageParams, 'limit' | 'pageToken'> {
  agentId?: string;
  /** Multi-agent filter; combined with `agentId` when both are set. */
  agentIds?: string[];
}

export interface CreateScheduleRequest {
  agentId: string;
  name: string;
  task: string;
  cron: string;
  timezone?: string;
  status?: ScheduleStatus;
}

/** `agentId` is not on the base update body; hosts that allow rebinding can extend `TUpdate`. */
export interface UpdateScheduleRequest {
  id: string;
  name: string;
  task: string;
  cron: string;
  timezone?: string;
  status?: ScheduleStatus;
}

export interface CreateScheduleRunRequest {
  scheduleId: string;
}

export interface ScheduleServer<
  TSchedule extends Schedule = Schedule,
  TCreate extends CreateScheduleRequest = CreateScheduleRequest,
  TUpdate extends UpdateScheduleRequest = UpdateScheduleRequest,
  TRun extends ScheduleRun = ScheduleRun,
> {
  listSchedules(req?: ListSchedulesParams): Promise<ListResult<TSchedule>>;
  getSchedule(req: { id: string }): Promise<TSchedule>;
  createSchedule(req: TCreate): Promise<TSchedule>;
  updateSchedule(req: TUpdate): Promise<TSchedule>;
  deleteSchedule(req: { id: string }): Promise<void>;
  listScheduleRuns(req: { scheduleId: string }): Promise<TRun[]>;
  createScheduleRun(req: CreateScheduleRunRequest): Promise<TRun>;
}

// ---------------------------------------------------------------------------
// Permissions — optional resource mutation grants
// ---------------------------------------------------------------------------

export type PermissionResourceType = 'agent' | 'schedule' | 'session' | 'tenant';

export type ResourcePermission = 'USE' | 'MANAGE' | 'DELETE' | 'CREATE';

export interface ListPermissionsRequest {
  resourceType: PermissionResourceType;
  resourceIds: string[];
}

export interface ListPermissionsResponse {
  data: {
    type: PermissionResourceType;
    permissions: Record<string, ResourcePermission[]>;
  };
}

export interface PermissionsServer<
  TRequest extends ListPermissionsRequest = ListPermissionsRequest,
  TResponse extends ListPermissionsResponse = ListPermissionsResponse,
> {
  listPermissions(req: TRequest): Promise<TResponse>;
}

// ---------------------------------------------------------------------------
// AgentMetrics — optional aggregate metrics + time-series charts
// ---------------------------------------------------------------------------

export type AgentMetricChartType = 'line';

export interface AgentMetricChartDefinition {
  name: string;
  displayName: string;
  description: string;
  chartType: AgentMetricChartType;
}

export interface AgentMetricMeter {
  name: string;
  aggregateValue: number;
  description: string;
  unit: string;
}

export interface AgentMetricPoint {
  timestamp: string;
  value: number;
}

export interface AgentMetricGraphLine<TPoint extends AgentMetricPoint = AgentMetricPoint> {
  name: string;
  values: TPoint[];
}

export interface AgentMetricGraph<TLine extends AgentMetricGraphLine = AgentMetricGraphLine> {
  name: string;
  displayName: string;
  description: string;
  unit: string;
  chartType: AgentMetricChartType;
  graphLines: TLine[];
}

export interface AgentMetricChartData<TGraph extends AgentMetricGraph = AgentMetricGraph> {
  step: string;
  graphs: TGraph[];
}

export interface AgentMetricRangeRequest {
  agentId: string;
  startTimestamp: string;
  endTimestamp: string;
}

export interface AgentMetricChartDataRequest extends AgentMetricRangeRequest {
  chartName: string;
}

export interface AgentMetricsServer<
  TChart extends AgentMetricChartDefinition = AgentMetricChartDefinition,
  TMeter extends AgentMetricMeter = AgentMetricMeter,
  TChartData extends AgentMetricChartData = AgentMetricChartData,
  TRangeRequest extends AgentMetricRangeRequest = AgentMetricRangeRequest,
  TChartDataRequest extends AgentMetricChartDataRequest = AgentMetricChartDataRequest,
> {
  getCharts(): Promise<TChart[]>;
  getMeters(req: TRangeRequest): Promise<TMeter[]>;
  getChartData(req: TChartDataRequest): Promise<TChartData>;
}

/**
 * Composed host port: chat + builder + optional settings catalog + optional
 * agent-detail / sessions shell + optional schedules surface + optional metrics.
 *
 * `catalog` is optional — if the host passes it, settings UI can call
 * `useCatalogServer()` / show modelCatalog, connectorCatalog, and skillCatalog;
 * if omitted, those surfaces stay hidden.
 *
 * `sessions` is optional — if the host passes it, agent-detail UI can call
 * `useAgentSessionsServer()` / Overview + sessions under an agent; if omitted,
 * that surface stays hidden.
 *
 * `schedules` is optional — if the host passes it, schedules UI can call
 * `useScheduleServer()` / list and manage schedules; if omitted, that surface
 * stays hidden.
 *
 * `metrics` is optional — if the host passes it, agent-detail UI can render
 * aggregate meter cards and time-series charts.
 *
 * trueforge-ui re-exports this as `AgentUIServer`.
 */
export type AgentUIServerPort<
  TChat extends AgentChatServer = AgentChatServer,
  TBuilder extends AgentBuilderServer = AgentBuilderServer,
  TCatalog extends CatalogServer = CatalogServer,
  TSessions extends AgentSessionsServer = AgentSessionsServer,
  TSchedules extends ScheduleServer = ScheduleServer,
  TMetrics extends AgentMetricsServer = AgentMetricsServer,
  TPermissions extends PermissionsServer = PermissionsServer,
> = TChat &
  TBuilder & {
    catalog?: TCatalog;
    sessions?: TSessions;
    schedules?: TSchedules;
    metrics?: TMetrics;
    permissions?: TPermissions;
    /** Authenticated caller identity. Used for tenant-scoped share copy. */
    getMe?: () => Promise<{ tenantId: string }>;
  };

/** Host-facing alias used by trueforge-ui. */
export type AgentUIServer = AgentUIServerPort;
