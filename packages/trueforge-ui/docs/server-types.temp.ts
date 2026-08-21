/**
 * TEMP: Self-contained server types (copied, no imports)
 *
 * Draft only. Not wired into the package.
 *
 * Intent:
 * - One session surface (no draft/named method split). Named vs inline-spec is
 *   data on the session (`agentName` / `agentSpec`), not parallel APIs.
 * - MUI-style constrained generics everywhere hosts implement or extend:
 *   `T extends Base = Base` — SDK declares the minimum; hosts add extras.
 *
 * Live code still re-exports from gateway (src/server/types.ts) until you
 * promote this draft.
 *
 * Source pin (approx): truefoundry-gateway-sdk@0.4.0-rc.1
 */

// ---------------------------------------------------------------------------
// Catalog (SDK-owned — already local)
// ---------------------------------------------------------------------------

/**
 * SDK-required model row. Hosts may add fields via `TModel extends ModelEntry`.
 * Written to `AgentSpec.model.name` (host maps display → api id as needed).
 *
 * @example
 * ```ts
 * type MyModel = ModelEntry & { apiModel: string; modelId: string };
 * // → AgentSpec.model.name = model.apiModel
 * ```
 */
export interface ModelEntry {
  /** Display label in the model picker, e.g. `"Sonnet 5"`. */
  name: string;
  /** Provider id for icon / grouping, e.g. `"anthropic"`. */
  provider: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  description?: string;
}

/**
 * SDK-required MCP connector row. Written to `AgentSpec.mcpServers[].name`.
 *
 * @example
 * ```ts
 * const mcp: ConnectorState = {
 *   id: "1",
 *   name: "ai-gateway-mcp",
 *   description: "mcp server for ai gateway",
 * };
 * // → AgentSpec.mcpServers[].name = mcp.name
 * ```
 */
export interface ConnectorState {
  /** Stable id for list keys, e.g. `"1"`. */
  id: string;
  /** Registry name mounted onto `mcpServers`, e.g. `"ai-gateway-mcp"`. */
  name: string;
  /** Optional blurb for the picker, e.g. `"mcp server for ai gateway"`. */
  description?: string;
}

export interface AgentLibraryEntry {
  name: string;
}

export type SearchAgentsParams = {
  limit?: number;
  offset?: number;
};

export type DraftAgentSpecPatch = {
  model: {
    name: string;
    params?: { maxTokens?: number; reasoningEffort?: string };
  };
  skills: { fqn: string; preload: false }[];
  mcpServers: {
    type: 'truefoundry-mcp-registry';
    name: string;
    enableTools: ['@all'];
  }[];
};

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

export interface TokenPagination {
  nextPageToken?: string;
  previousPageToken?: string;
  limit: number;
}

/** Structural page shape hosts must satisfy (gateway `Page` is a class). */
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
  startTimestamp?: string;
  endTimestamp?: string;
};

export type PreviousTurnIdInput = 'auto' | 'none' | string;

// ---------------------------------------------------------------------------
// AgentSpec (+ nested) — base; hosts extend via TSpec extends AgentSpec
// ---------------------------------------------------------------------------

export interface ModelParamsCacheControl {
  type: string;
}

export interface ModelParams {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  parallelToolCalls?: boolean;
  reasoningEffort?: string;
  cacheControl?: ModelParamsCacheControl;
}

export interface Model {
  name: string;
  params?: ModelParams;
}

export interface SkillMount {
  fqn: string;
  preload?: boolean;
}

export type ToolsSelectorTag = '@all' | '@read-only';
export type ToolsSelectorItem = ToolsSelectorTag | string;

export type RequireApprovalToolsSelectorTag = '@all' | '@write' | '@destructive';
export type RequireApprovalToolSelectorItem = RequireApprovalToolsSelectorTag | string;

export interface BaseMcpServer {
  name: string;
  enableTools?: ToolsSelectorItem[];
  disableTools?: ToolsSelectorItem[];
  preloadTools?: ToolsSelectorItem[];
  requireApprovalForTools?: RequireApprovalToolSelectorItem[];
  preload?: boolean;
}

export interface RegisteredMcpServer extends BaseMcpServer {
  type: 'truefoundry-mcp-registry';
}

export interface InlineMcpServer extends BaseMcpServer {
  type: 'inline';
  url: string;
}

export type McpServer = RegisteredMcpServer | InlineMcpServer;

export interface AgentSpecUserMessage {
  type: 'user.message';
  content: string;
}

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      jsonSchema: {
        name: string;
        description?: string;
        schema?: Record<string, unknown>;
        strict?: boolean;
      };
    };

export interface RuntimeConfig {
  iterationLimit?: number;
  sandbox?: {
    enabled: boolean;
    fileDownloads?: boolean;
  };
  dynamicSubAgents?: { enabled?: boolean };
  contextManagement?: {
    compaction?: CompactionConfig;
    largeToolResponse?: { enabled?: boolean };
  };
  generativeUi?: { enabled?: boolean };
  askUserQuestions?: { enabled?: boolean };
}

export interface CompactionConfig {
  enabled?: boolean;
  trigger?: {
    type: 'input_tokens';
    value: number;
  };
}

/** Agent definition base. Hosts extend via `TSpec extends AgentSpec`. */
export interface AgentSpec {
  model: Model;
  instructions?: string;
  messages?: AgentSpecUserMessage[];
  mcpServers?: McpServer[];
  // responseFormat?: ResponseFormat;
  skills?: SkillMount[];
  // config?: RuntimeConfig;
}

export type AgentSpecUpdate = {
  instructions?: string;
  model?: Partial<Model> & {
    params?: Partial<ModelParams>;
  };
  mcpServers?: McpServer[];
  skills?: SkillMount[];
  messages?: AgentSpecUserMessage[];
  responseFormat?: ResponseFormat;
  config?: RuntimeConfig;
};

// ---------------------------------------------------------------------------
// Session — one shape (named vs inline-spec is data, not dual APIs)
// ---------------------------------------------------------------------------

/**
 * SDK-minimal session row.
 * - Bound to a published agent → `agentName` set, `agentSpec` usually absent.
 * - Inline / mutable spec → `agentSpec` set (host may still set `agentName`).
 * - `isMutable` tells the UI whether to show the mutable agent-spec builder
 *   (and allow `updateSession`); do not infer from `agentSpec` alone.
 * Hosts add extras via `TSession extends Session`.
 */
export interface Session {
  id: string;
  title?: string;
  agentName?: string;
  agentSpec?: AgentSpec;
  /** UI: mutable builder + `updateSession(spec)` when true; immutable otherwise. */
  isMutable: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Create payload base. Provide at least one of `agentName` | `agentSpec`
 * (enforced by host / runtime, not the type system).
 * Hosts add extras via `TCreate extends CreateSessionRequest`.
 */
export interface CreateSessionRequest {
  agentName?: string;
  agentSpec?: AgentSpec;
}

/** List filter + pagination. Hosts extend via `TList extends ListSessionsParams`. */
export interface ListSessionsParams extends PageParams {
  /**
   * Host-owned agent identity filter. Hosts that key agents by name pass that name here.
   * Unknown / deleted ids MUST return an empty page (stale history filter, SingleAgent
   * mismatch) — do not throw and fail the whole thread list.
   */
  agentId?: string;
}

/**
 * Patch session (title / inline spec). No-op or error when `isMutable` is false.
 * Hosts extend via `TUpdate extends UpdateSessionRequest`.
 */
export interface UpdateSessionRequest {
  sessionId: string;
  agentSpec?: AgentSpec;
  title?: string;
}

export interface ListSessionsResponse<TSession extends Session = Session> {
  data: TSession[];
  pagination: TokenPagination;
}

// ---------------------------------------------------------------------------
// Turn input / state
// ---------------------------------------------------------------------------

export type UserMessageContent =
  string | Array<{ type: 'text'; text: string } | { type: 'file'; [key: string]: unknown }>;

export interface UserMessage {
  type: 'user.message';
  content: UserMessageContent;
}

export interface ApprovalAllow {
  status: 'allow';
}

export interface ApprovalDeny {
  status: 'deny';
  reason?: string;
}

export type ApprovalDecision = ApprovalAllow | ApprovalDeny;

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

export interface TurnStateDone {
  status: 'done';
  output?: {
    type: 'model.message';
    id: string;
    threadId: string;
    createdAt: string;
    content?: unknown;
    name?: string;
    refusal?: string;
    reasoningContent?: string;
    toolCalls?: unknown[];
    finishReason?: string;
    usage?: unknown;
  };
  requiredActions: unknown[];
  completedAt: string;
}

export type TurnStateCancelledReason =
  'server-execution-timeout' | 'client-cancelled' | 'cancelled-for-next-turn' | 'abandoned';

export interface TurnStateCancelled {
  status: 'cancelled';
  reason: TurnStateCancelledReason;
  completedAt: string;
}

export interface TurnStateError {
  status: 'error';
  message: string;
  completedAt: string;
}

export type TurnState = TurnStateRunning | TurnStateDone | TurnStateCancelled | TurnStateError;

/** SDK-minimal turn. Hosts extend via `TTurn extends Turn`. */
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
// Stream / session events
// ---------------------------------------------------------------------------

/**
 * Opaque streaming event (full union lives in gateway).
 * Hosts may narrow via `TStreamEvent extends TurnStreamingEvent`.
 */
export type TurnStreamingEvent = { type: string; [key: string]: unknown };

export interface TurnStreamData<TStreamEvent extends TurnStreamingEvent = TurnStreamingEvent> {
  sequenceNumber: number;
  event: TStreamEvent;
}

export type SessionEvent = { type: string; [key: string]: unknown };

/** SDK-minimal history event row. Hosts extend via `TEvent extends SessionEventItem`. */
export interface SessionEventItem {
  turnId: string;
  event: SessionEvent;
}

export interface ListSessionEventsResponse<TEvent extends SessionEventItem = SessionEventItem> {
  data: TEvent[];
  pagination: TokenPagination;
}

// ---------------------------------------------------------------------------
// Behavioral session surface (DTO + methods)
// ---------------------------------------------------------------------------

export interface PreparedTurn<TStreamEvent extends TurnStreamingEvent = TurnStreamingEvent> {
  execute(opts: { stream: false; pollIntervalMs?: number }): Promise<TurnState>;
  execute(opts?: { stream?: true }): AsyncIterable<TurnStreamData<TStreamEvent>>;
}

export interface SessionMethods<
  TTurn extends Turn = Turn,
  TEvent extends SessionEventItem = SessionEventItem,
  TSpec extends AgentSpec = AgentSpec,
  TStreamEvent extends TurnStreamingEvent = TurnStreamingEvent,
> {
  prepareTurn(opts?: { input?: TurnInputItem[]; previousTurnId?: PreviousTurnIdInput }): PreparedTurn<TStreamEvent>;
  listTurns(opts?: { pageToken?: string; limit?: number }): Promise<PageResult<TTurn, ListTurnsResponse<TTurn>>>;
  getTurn(req: { turnId: string }): Promise<TTurn>;
  cancel(): Promise<void>;
  listEvents(opts?: {
    pageToken?: string;
    lastTurnId?: string;
    limit?: number;
  }): Promise<PageResult<TEvent, ListSessionEventsResponse<TEvent>>>;
  /** Present when `isMutable` is true. */
  update?(req?: { agentSpec?: TSpec }): Promise<void>;
}

export type AgentSession<
  TSession extends Session = Session,
  TTurn extends Turn = Turn,
  TEvent extends SessionEventItem = SessionEventItem,
  TSpec extends AgentSpec = AgentSpec,
  TStreamEvent extends TurnStreamingEvent = TurnStreamingEvent,
> = TSession & SessionMethods<TTurn, TEvent, TSpec, TStreamEvent>;

// ---------------------------------------------------------------------------
// Server ports
// ---------------------------------------------------------------------------

/**
 * Unified chat / session port.
 * TFY adapter may still fan out to gateway createSession vs createDraftSession
 * internally — that is an implementation detail, not part of this contract.
 */
export interface AgentChatServer<
  TSession extends Session = Session,
  TCreate extends CreateSessionRequest = CreateSessionRequest,
  TList extends ListSessionsParams = ListSessionsParams,
  TUpdate extends UpdateSessionRequest = UpdateSessionRequest,
  TTurn extends Turn = Turn,
  TEvent extends SessionEventItem = SessionEventItem,
  TSpec extends AgentSpec = AgentSpec,
  TStreamEvent extends TurnStreamingEvent = TurnStreamingEvent,
> {
  createSession(req: TCreate): Promise<AgentSession<TSession, TTurn, TEvent, TSpec, TStreamEvent>>;
  listSessions(
    req?: TList,
  ): Promise<PageResult<AgentSession<TSession, TTurn, TEvent, TSpec, TStreamEvent>, ListSessionsResponse<TSession>>>;
  getSession(req: { sessionId: string }): Promise<AgentSession<TSession, TTurn, TEvent, TSpec, TStreamEvent>>;
  updateSession(req: TUpdate): Promise<AgentSession<TSession, TTurn, TEvent, TSpec, TStreamEvent>>;

  createTurn(req: {
    sessionId: string;
    input?: TurnInputItem[];
    previousTurnId?: PreviousTurnIdInput;
    stream: false;
    pollIntervalMs?: number;
  }): Promise<TurnState>;
  createTurn(req: {
    sessionId: string;
    input?: TurnInputItem[];
    previousTurnId?: PreviousTurnIdInput;
    stream?: true;
  }): AsyncIterable<TurnStreamData<TStreamEvent>>;

  cancelSession(req: { sessionId: string }): Promise<void>;
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

export interface AgentBuilderServer<
  TModel extends ModelEntry = ModelEntry,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSpec extends AgentSpec = AgentSpec,
  TSave = unknown,
> {
  getModels(): Promise<TModel[]>;
  getSkills(): Promise<TSkill[]>;
  getMcp(): Promise<TMcp[]>;
  listAgents(req?: SearchAgentsParams): Promise<TAgent[]>; // for now only pagination, no search
  saveAgent(req: {
    agentName: string;
    agentSpec: TSpec;
    /** Session that held the inline spec being promoted (if any). */
    sessionId?: string;
  }): Promise<TSave>;
  deleteAgent?(req: { agentName: string }): Promise<void>;
}

export type AgentUIServer<
  TSession extends Session = Session,
  TCreate extends CreateSessionRequest = CreateSessionRequest,
  TList extends ListSessionsParams = ListSessionsParams,
  TUpdate extends UpdateSessionRequest = UpdateSessionRequest,
  TTurn extends Turn = Turn,
  TEvent extends SessionEventItem = SessionEventItem,
  TSpec extends AgentSpec = AgentSpec,
  TStreamEvent extends TurnStreamingEvent = TurnStreamingEvent,
  TModel extends ModelEntry = ModelEntry,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSave = unknown,
> = AgentChatServer<TSession, TCreate, TList, TUpdate, TTurn, TEvent, TSpec, TStreamEvent> &
  AgentBuilderServer<TModel, TSkill, TMcp, TAgent, TSpec, TSave>;

// Todo : Make the SkillsMount as Generic

// TrueForge SDK FE -> Generic Type // User can bring his own APIs (no touch to our client)
// Runtime // (Decouple from  the SDK Client)
// TrueForge SDK FE -> Work was done here

//Generic -> TrueForge SDK FE -> Runtime + Gateway SDK -> Backend (Generic)
// Should our Runtime package not have the Gateway SDK
