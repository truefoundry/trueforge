# TEMP: Self-contained server types (copied, no imports)

> **Draft only.** Not wired into the package.
> Types below are **pasted** from `truefoundry-gateway-sdk` / runtime shapes so you can read the contract without imports.
> Live code still re-exports from gateway (`src/server/types.ts`) until you decide to promote.

Source pin (approx): `truefoundry-gateway-sdk@0.4.0-rc.1`

---

## Catalog (SDK-owned — already local)

```ts
export interface ModelEntry {
  name: string;
  provider: string;
  apiModel: string;
  modelId: string;
}

export interface AgentSkill {
  id: string;
  name: string;
  fqn?: string;
  description?: string;
}

export interface ConnectorState {
  id: string;
  name: string;
  description?: string;
}

export interface AgentLibraryEntry {
  name: string;
  description?: string;
  model?: string;
  skillsCount?: number;
  mcpCount?: number;
  author?: string;
  updatedAt?: string;
}

export type SearchAgentsParams = {
  query?: string;
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
```

---

## Gateway / runtime shapes (copied)

### Subject

```ts
export interface Subject {
  subjectId: string;
  subjectType: string;
  subjectSlug: string;
}
```

### Pagination

```ts
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
```

### AgentSpec (+ nested)

```ts
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
  /** Fully qualified name of the agent skill version. */
  fqn: string;
  /** If true, SKILL.md is injected into agent context. */
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

/** Agent Definition (gateway `TruefoundryGatewayApi.AgentSpec`) */
export interface AgentSpec {
  model: Model;
  instructions?: string;
  messages?: AgentSpecUserMessage[];
  mcpServers?: McpServer[];
  responseFormat?: ResponseFormat;
  skills?: SkillMount[];
  config?: RuntimeConfig;
}

/** Partial patch (from `@truefoundry/assistant-ui-runtime`) */
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
```

### Session / DraftSession

```ts
export interface Session {
  type: 'session';
  id: string;
  agentName: string;
  title?: string;
  createdBySubject: Subject;
  createdAt: string;
  updatedAt: string;
}

export interface DraftSession {
  type: 'session/draft';
  id: string;
  agentSpec: AgentSpec;
  agentName?: string;
  title?: string;
  createdBySubject: Subject;
  createdAt: string;
  updatedAt: string;
}
```

### Turn input / state

```ts
export type UserMessageContent =
  | string
  | Array<
      | { type: 'text'; text: string } // TextContent (simplified)
      | { type: 'file'; /* FileContent — see gateway */ [key: string]: unknown }
    >;

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
  requiredActions: unknown[]; // ActionRequiredEvent[] in gateway
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

export interface Turn {
  id: string;
  sessionId: string;
  previousTurnId?: string;
  input?: TurnInputItem[];
  state: TurnState;
  createdBySubject: Subject;
  createdAt: string;
}
```

### Stream / session events

```ts
/**
 * Gateway `TurnStreamingEvent` union (names only — full event payloads in gateway):
 * ModelMessageEvent | ModelMessageDeltaEvent | ToolResponseEvent |
 * ThreadCreatedEvent | ThreadDoneEvent | McpAuthRequiredEvent | McpInitializeEvent |
 * SandboxCreatedEvent | ToolApprovalRequiredEvent | ToolResponseRequiredEvent |
 * TurnCreatedEvent | TurnDoneEvent
 */
export type TurnStreamingEvent = { type: string; [key: string]: unknown };

export interface TurnStreamData {
  /** SSE event id for resume via subscribeToTurn. */
  sequenceNumber: number;
  event: TurnStreamingEvent;
}

/**
 * Gateway `SessionEvent` union (subset of streaming, without deltas):
 * TurnCreatedEvent | TurnDoneEvent | ModelMessageEvent | ToolResponseEvent |
 * ThreadCreatedEvent | ThreadDoneEvent | McpAuthRequiredEvent | McpInitializeEvent |
 * SandboxCreatedEvent | ToolApprovalRequiredEvent | ToolResponseRequiredEvent
 */
export type SessionEvent = { type: string; [key: string]: unknown };

export interface SessionEventItem {
  turnId: string;
  event: SessionEvent;
}
```

### List responses

```ts
export interface ListSessionsResponse {
  data: Session[];
  pagination: TokenPagination;
}

export interface ListDraftSessionsResponse {
  data: DraftSession[];
  pagination: TokenPagination;
}

export interface ListOwnedSessionsResponse {
  data: Array<Session | DraftSession>;
  pagination: TokenPagination;
}

export interface ListTurnsResponse {
  data: Turn[];
  pagination: TokenPagination;
}

export interface ListSessionEventsResponse {
  data: SessionEventItem[];
  pagination: TokenPagination;
}
```

### Behavioral session surfaces (classes → structural paste)

Gateway ships `AgentSession` / `AgentDraftSession` as classes. For a BYO-facing
copy, treat them as DTO + methods:

```ts
export interface PreparedTurn {
  execute(opts: { stream: false; pollIntervalMs?: number }): Promise<TurnState>;
  execute(opts?: { stream?: true }): AsyncIterable<TurnStreamData>;
}

export interface AgentSession extends Session {
  prepareTurn(opts?: { input?: TurnInputItem[]; previousTurnId?: PreviousTurnIdInput }): PreparedTurn;
  listTurns(opts?: { pageToken?: string; limit?: number }): Promise<PageResult<Turn, ListTurnsResponse>>;
  getTurn(req: { turnId: string }): Promise<Turn>;
  cancel(): Promise<void>;
  listEvents(opts?: {
    pageToken?: string;
    lastTurnId?: string;
    limit?: number;
  }): Promise<PageResult<SessionEventItem, ListSessionEventsResponse>>;
}

export interface AgentDraftSession extends DraftSession {
  update(req?: { agentSpec?: AgentSpec }): Promise<void>;
  prepareTurn(opts?: { input?: TurnInputItem[]; previousTurnId?: PreviousTurnIdInput }): PreparedTurn;
  listTurns(opts?: { pageToken?: string; limit?: number }): Promise<PageResult<Turn, ListTurnsResponse>>;
  getTurn(req: { turnId: string }): Promise<Turn>;
  cancel(): Promise<void>;
  listEvents(opts?: {
    pageToken?: string;
    lastTurnId?: string;
    limit?: number;
  }): Promise<PageResult<SessionEventItem, ListSessionEventsResponse>>;
}
```

---

## Server ports (using the copies above)

```ts
export interface AgentChatServer {
  createSession(req: { agentName: string; tfyMetadata?: string }): Promise<AgentSession>;
  // listSessions(
  //   req: { agentName: string } & PageParams,
  // ): Promise<PageResult<AgentSession, ListSessionsResponse>>;
  getSession(req: { sessionId: string }): Promise<AgentSession>;

  createDraftSession(req: {
    agentSpec: AgentSpec;
    agentName?: string;
    tfyMetadata?: string;
  }): Promise<AgentDraftSession>;
  getDraftSession(req: { draftSessionId: string }): Promise<AgentDraftSession>;
  // listDraftSessions(
  //   req?: { agentName?: string } & PageParams,
  // ): Promise<PageResult<AgentDraftSession, ListDraftSessionsResponse>>;
  listSessions( // for all the sessions listing
    req?: { agentName?: string } & PageParams, // agentName filter
  ): Promise<PageResult<AgentSession | AgentDraftSession, ListOwnedSessionsResponse>>;
  updateDraftSession(req: { draftSessionId: string; agentSpec?: AgentSpec }): Promise<AgentDraftSession>;

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
  }): AsyncIterable<TurnStreamData>;

  cancelSession(req: { sessionId: string }): Promise<void>;
  deleteSession?(req: { sessionId: string }): Promise<void>;
  listTurns(req: {
    sessionId: string;
    limit?: number;
    pageToken?: string;
  }): Promise<PageResult<Turn, ListTurnsResponse>>;
  getTurn(req: { sessionId: string; turnId: string }): Promise<Turn>;
  listEvents(req: {
    sessionId: string;
    pageToken?: string;
    lastTurnId?: string;
    limit?: number;
  }): Promise<PageResult<SessionEventItem, ListSessionEventsResponse>>;
  subscribeToTurn?(req: {
    sessionId: string;
    turnId: string;
    afterSequenceNumber?: number;
  }): AsyncIterable<TurnStreamData>;

  downloadSandboxFile?(sandboxId: string, req: { path: string }): Promise<unknown>; // BinaryResponse in gateway
}

export interface AgentBuilderServer<
  TModel extends ModelEntry = ModelEntry,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSave = unknown,
> {
  getModels(): Promise<TModel[]>;
  getSkills(): Promise<TSkill[]>;
  getMcp(): Promise<TMcp[]>;
  searchAgents(req?: SearchAgentsParams): Promise<TAgent[]>;
  saveAgent(req: { agentName: string; agentSpec: AgentSpec; draftSessionId?: string }): Promise<TSave>;
  deleteAgent?(req: { agentName: string }): Promise<void>;
}

export type AgentUIServer<
  TModel extends ModelEntry = ModelEntry,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSave = unknown,
> = AgentChatServer & AgentBuilderServer<TModel, TSkill, TMcp, TAgent, TSave>;
```

---

## Notes / gaps in this paste

- `TurnStreamingEvent` / `SessionEvent` / some `TurnStateDone` leaves are **summarized** (`unknown` / `{ type: string }`) — full event payloads are large gateway unions; expand on demand.
- `Page` in gateway is a **class**; `PageResult` above is a structural stand-in.
- Live `src/server/types.ts` still **imports/re-exports** gateway — this file is documentation / promotion draft only.
