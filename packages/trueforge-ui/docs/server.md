# Plan: Server abstraction (UI SDK only)

Host-facing port so TrueFoundry gateway **or** bring-your-own APIs plug into one
contract:

- **Chat** — sessions, turns, draft `AgentSpec` sync
- **Builder** — catalog (models / skills / MCP, read-only) + `saveAgent`
  (promote draft → named agent)

## Constraint

Everything lives in **`@truefoundry/trueforge-ui`**.

**No changes** to `@truefoundry/assistant-ui-runtime`.

The runtime keeps accepting `client: AgentSessionClient` (and `privateClient`
for draft). This package owns the host-facing `Server` façade and adapters.

## Implication (explicit)

| Concern                                                          | Reality in this plan                                                                                                                          |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| BYO builder (`getModels` / `getSkills` / `getMcp` / `saveAgent`) | Real — implemented and consumed in this SDK                                                                                                   |
| BYO chat streaming                                               | Limited — hosts must still supply gateway-compatible clients to the runtime, **or** wrap their API behind objects the runtime already expects |
| `AgentChatServer`                                                | Stable **host** API in this SDK; TFY path extracts/passes gateway clients into the unchanged runtime                                          |

## Locked decisions

| Decision                      | Choice                                                                                                      |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Shape                         | TypeScript `interface` (compose), not inheritance                                                           |
| Split                         | `AgentChatServer` + `AgentBuilderServer`                                                                    |
| Package                       | This SDK only                                                                                               |
| Modes (v1)                    | Named + Draft (single agent)                                                                                |
| Chat request / response types | Gateway SDK types (`AgentSession`, `AgentSpec`, `Turn`, …)                                                  |
| Catalog types                 | SDK-minimal `ModelEntry` / `AgentSkill` / `ConnectorState` / `AgentLibraryEntry`; hosts extend via generics |
| `saveAgent`                   | Promote draft `AgentSpec` → named agent; return stays host-defined for now                                  |
| Catalog lists                 | Read-only in v1                                                                                             |
| Runtime                       | Unchanged; still `client` / `privateClient` / `agent`                                                       |
| Chat generics                 | **None** in v1 — session/turn types are gateway-fixed re-exports                                            |

## Interfaces (target)

Chat types are imported from `truefoundry-gateway-sdk` (agents + API).
`AgentSpec` is gateway SDK (`TruefoundryGatewayApi.AgentSpec`), re-exported by
`@truefoundry/assistant-ui-runtime`. Builder catalog types are **SDK-minimal**
(fields this UI reads); hosts keep extras typed with `T extends Base`.

```ts
import type { AgentSession, AgentDraftSession, Turn, TurnStreamData } from 'truefoundry-gateway-sdk/agents';
import type {
  AgentSpec,
  TurnInputItem,
  PreviousTurnIdInput,
  TurnState,
  SessionEventItem,
  ListSessionsResponse,
  ListDraftSessionsResponse,
  ListOwnedSessionsResponse,
  ListTurnsResponse,
  ListSessionEventsResponse,
  ListSessionsOrder,
} from 'truefoundry-gateway-sdk';
import type { Page, BinaryResponse } from 'truefoundry-gateway-sdk/core'; // or equivalent core export

type PageParams = {
  limit?: number;
  order?: ListSessionsOrder;
  pageToken?: string;
  startTimestamp?: string;
  endTimestamp?: string;
};

/** Chat / session port — gateway-fixed (not generic). */
interface AgentChatServer {
  // named
  createSession(req: { agentName: string; tfyMetadata?: string }): Promise<AgentSession>;
  listSessions(req: { agentName: string } & PageParams): Promise<Page<AgentSession, ListSessionsResponse>>;
  getSession(req: { sessionId: string }): Promise<AgentSession>;

  // draft
  createDraftSession(req: {
    agentSpec: AgentSpec;
    agentName?: string;
    tfyMetadata?: string;
  }): Promise<AgentDraftSession>;
  getDraftSession(req: { draftSessionId: string }): Promise<AgentDraftSession>;
  listDraftSessions(
    req?: { agentName?: string } & PageParams,
  ): Promise<Page<AgentDraftSession, ListDraftSessionsResponse>>;
  listOwnedSessions(
    req?: { agentName?: string } & PageParams,
  ): Promise<Page<AgentSession | AgentDraftSession, ListOwnedSessionsResponse>>;
  /** Port helper: getDraftSession + update. Runtime draft sync may still go via privateClient. */
  updateDraftSession(req: { draftSessionId: string; agentSpec?: AgentSpec }): Promise<AgentDraftSession>;

  // turns (overloads match PreparedTurn.execute)
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
  /** Host/BFF — optional until delete-UI ships. */
  deleteSession?(req: { sessionId: string }): Promise<void>;
  listTurns(req: { sessionId: string; limit?: number; pageToken?: string }): Promise<Page<Turn, ListTurnsResponse>>;
  getTurn(req: { sessionId: string; turnId: string }): Promise<Turn>;
  listEvents(req: {
    sessionId: string;
    pageToken?: string;
    lastTurnId?: string;
    limit?: number;
  }): Promise<Page<SessionEventItem, ListSessionEventsResponse>>;
  subscribeToTurn(req: {
    sessionId: string;
    turnId: string;
    afterSequenceNumber?: number;
  }): AsyncIterable<TurnStreamData>;

  downloadSandboxFile?(sandboxId: string, req: { path: string }): Promise<BinaryResponse>;
}

/**
 * Builder catalog + persist.
 * Not in truefoundry-gateway-sdk — host/BFF provides these.
 * Like MUI Table: bases declare what the SDK needs; T extends Base keeps host extras typed.
 */
interface AgentBuilderServer<
  TModel extends ModelEntry = ModelEntry,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSave = unknown,
> {
  getModels(): Promise<TModel[]>;
  getSkills(): Promise<TSkill[]>;
  getMcp(): Promise<TMcp[]>;
  /** Search / list named agents for the Agents. */
  searchAgents(req?: { query?: string; limit?: number; offset?: number }): Promise<TAgent[]>;
  /** Promote draft AgentSpec → named agent */
  saveAgent(req: { agentName: string; agentSpec: AgentSpec; draftSessionId?: string }): Promise<TSave>;
  /** Host/BFF — optional until delete-agent UI ships. */
  deleteAgent?(req: { agentName: string }): Promise<void>;
}

type AgentUIServer<
  TModel extends ModelEntry = ModelEntry,
  TSkill extends AgentSkill = AgentSkill,
  TMcp extends ConnectorState = ConnectorState,
  TAgent extends AgentLibraryEntry = AgentLibraryEntry,
  TSave = unknown,
> = AgentChatServer & AgentBuilderServer<TModel, TSkill, TMcp, TAgent, TSave>;
```

Defaults keep bare `AgentUIServer` equivalent to the SDK-minimal catalog shapes.
**Note:** Gateway session helpers are class instances (`AgentSession` /
`AgentDraftSession` with methods). The TFY adapter returns those directly. BYO
implementations must return values that satisfy the same types (or wrap until
the port only exposes plain DTOs — not required for v1).

Plain DTOs are also re-exported as `Session` / `DraftSession` (`TruefoundryGatewayApi`).

### Extending catalog types

```ts
type MyModel = ModelEntry & { latencyMs: number };

const server: AgentUIServer<MyModel> = createTrueFoundryServer({
  // …
  getModels: async () => [
    {
      id: '…',
      name: '…',
      provider: { name: '…' },
      properties: {},
      apiModel: '…',
      modelId: '…',
      latencyMs: 12,
    },
  ],
});
// server.getModels() → Promise<MyModel[]>
```

## Catalog APIs & AgentSpec Types

Catalog bases are **SDK-minimal** (fields this UI reads). Platform/cpApi payloads
may be richer — map them into these shapes, or keep extras via generics.

### Catalog methods

```ts
getModels(): Promise<ModelEntry[]>;
getSkills(): Promise<AgentSkill[]>;
getMcp(): Promise<ConnectorState[]>;
searchAgents(req?: { query?: string; limit?: number; offset?: number }): Promise<AgentLibraryEntry[]>;
```

In platform apps the RTK Query endpoints are named `getEnabledModels`,
`getAgentSkills`, `getMcpServers`, and `getAgents`
(`GET /api/svc/v1/agents?namePrefix=…`).

#### `AgentLibraryEntry`

```ts
interface AgentLibraryEntry {
  name: string;
  description?: string;
  model?: string;
  skillsCount?: number;
  mcpCount?: number;
  author?: string;
  updatedAt?: string;
}
```

#### `ModelEntry`

Written to `AgentSpec.model.name` via `apiModel` (fallback: `name`).

```ts
interface ModelEntry {
  name: string;
  provider: string;
  apiModel: string;
  modelId: string;
}
```

#### `AgentSkill`

Mounted onto `AgentSpec.skills` via `fqn` (fallback: `name`).

```ts
interface AgentSkill {
  id: string;
  name: string;
  fqn?: string;
  description?: string;
}
```

#### `ConnectorState`

Written to `AgentSpec.mcpServers[].name`.

```ts
interface ConnectorState {
  id: string;
  name: string;
  description?: string;
}
```

#### Session / DraftSession (gateway DTOs)

```ts
interface Session {
  type: 'session';
  id: string;
  agentName: string;
  title?: string;
  createdBySubject: Subject;
  createdAt: string;
  updatedAt: string;
}

interface DraftSession {
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

Thread list uses `id`, `title?`, `updatedAt`. Draft title falls back to
`agentSpec.model.name`. `AgentSession` / `AgentDraftSession` add methods on top.

### `AgentSpec` (complete)

Source of truth: `truefoundry-gateway-sdk` → `TruefoundryGatewayApi.AgentSpec`  
Re-exported by: `@truefoundry/assistant-ui-runtime`

```ts
interface AgentSpec {
  model: Model;
  instructions?: string;
  messages?: AgentSpecUserMessage[];
  mcpServers?: McpServer[];
  responseFormat?: ResponseFormat;
  skills?: SkillMount[];
  config?: RuntimeConfig;
}

interface CompactionConfig {
  enabled?: boolean;
  trigger?: {
    type: 'input_tokens';
    value: number;
  };
}

interface Model {
  name: string;
  params?: ModelParams;
}

interface ModelParams {
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  topK?: number;
  parallelToolCalls?: boolean;
  reasoningEffort?: string;
  cacheControl?: { type: string };
}

interface SkillMount {
  /** Fully qualified name of the agent skill version. */
  fqn: string;
  /** If true, SKILL.md is injected into agent context. */
  preload?: boolean;
}

type ToolsSelectorTag = '@all' | '@read-only';
type ToolsSelectorItem = ToolsSelectorTag | string;

type RequireApprovalToolsSelectorTag = '@all' | '@write' | '@destructive';
type RequireApprovalToolSelectorItem = RequireApprovalToolsSelectorTag | string;

interface BaseMcpServer {
  name: string;
  enableTools?: ToolsSelectorItem[];
  disableTools?: ToolsSelectorItem[];
  preloadTools?: ToolsSelectorItem[];
  requireApprovalForTools?: RequireApprovalToolSelectorItem[];
  preload?: boolean;
}

interface RegisteredMcpServer extends BaseMcpServer {
  type: 'truefoundry-mcp-registry';
}

interface InlineMcpServer extends BaseMcpServer {
  type: 'inline';
  url: string;
}

type McpServer = RegisteredMcpServer | InlineMcpServer;

interface AgentSpecUserMessage {
  type: 'user.message';
  content: string;
}

type ResponseFormat =
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

interface RuntimeConfig {
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
```

### `AgentSpecUpdate` (partial patch)

```ts
type AgentSpecUpdate = {
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

### Draft subset this app writes

Typical builder → draft patch shape (not the full `AgentSpec`):

```ts
{
  model: {
    name: string;
    params?: { maxTokens?: number; reasoningEffort?: string };
  };
  skills: { fqn: string; preload: false }[];
  mcpServers: {
    type: "truefoundry-mcp-registry";
    name: string;
    enableTools: ["@all"];
  }[];
}
```

## Gateway mapping (`AgentChatServer`)

| Port method                            | Gateway source                                  |
| -------------------------------------- | ----------------------------------------------- |
| `createSession`                        | `AgentSessionClient.createSession`              |
| `listSessions`                         | `AgentSessionClient.listSessions`               |
| `getSession`                           | `AgentSessionClient.getSession`                 |
| `createDraftSession`                   | `PrivateAgentSessionClient.createDraftSession`  |
| `getDraftSession`                      | `PrivateAgentSessionClient.getDraftSession`     |
| `listDraftSessions`                    | `PrivateAgentSessionClient.listDraftSessions`   |
| `listOwnedSessions`                    | `PrivateAgentSessionClient.listOwnedSessions`   |
| `updateDraftSession`                   | `getDraftSession` + `AgentDraftSession.update`  |
| `createTurn`                           | session `prepareTurn` → `execute` / stream      |
| `cancelSession`                        | session `cancel`                                |
| `listTurns` / `getTurn` / `listEvents` | session turn helpers                            |
| `subscribeToTurn`                      | turn `stream` / subscribe                       |
| `downloadSandboxFile`                  | `PrivateAgentSessionClient.downloadSandboxFile` |

**Not in gateway:** `getModels`, `getSkills`, `getMcp`, `searchAgents`, `saveAgent`,
`deleteAgent?`, `deleteSession?`.

## Call flow (end state)

```
Host
  └─ createTrueFoundryServer / custom AgentUIServer
TrueForgeUI({ server, agentConfig, … })
  ├─ builder UI ──► server.getModels / getSkills / getMcp / saveAgent
  └─ TrueFoundryChatProvider
        └─ useTrueFoundryAgentRuntime({
             client,          // from TFY adapter internals
             privateClient?,  // draft
             agent: named | draft
           })   // runtime package untouched
```

## Phases

### Phase 0 — Spec freeze

1. Keep this doc as the source of truth for interfaces and mapping.
2. Confirm compose type: `AgentUIServer = AgentChatServer & AgentBuilderServer`.

**Done when:** interfaces agreed; no code required.

### Phase 1 — Types + TFY compose helper

1. Add `AgentChatServer`, `AgentBuilderServer`, `AgentUIServer` under e.g. `src/server/`.
2. Add `createTrueFoundryServer({ apiKey, baseUrl, saveAgent, getModels?, getSkills?, getMcp? })`:
   - constructs `AgentSessionClient` + `PrivateAgentSessionClient`
   - implements chat methods as thin wraps
   - implements builder methods via host callbacks (`ModelEntry[]` / `AgentSkill[]` / `ConnectorState[]`)
   - exposes SDK-internal handles for the runtime, e.g.
     `getGatewayClients(): { client, privateClient }`
     (not part of the public BYO contract)
3. Export from the package entry.

**Done when:** types + factory exist; unit test that the factory returns both
clients and delegates `createSession` / `createDraftSession`.

### Phase 2 — Wire `server` into UI shell (named)

1. Extend `TrueFoundryChatProvider` / `TrueForgeUI`:
   - prefer `server: AgentUIServer`
   - keep legacy `client` or `apiKey` + `baseUrl` temporarily
2. When `server` is TFY-composed: resolve gateway clients → pass into existing
   `useTrueFoundryAgentRuntime({ client, privateClient?, agentName | agent })`.
3. Builder methods unused on the named-only path.

**Done when:** named agent works with
`server={createTrueFoundryServer(...)}` (same UX as today).

**Verify:** provider tests with a mock/TFY server that still supplies
gateway-shaped clients for the runtime.

### Phase 3 — Draft mode + builder port usage

1. Support `agentConfig` modes (`SingleAgent` | `AgentLibrary` |
   `AgentComposer` | `AgentLibraryWithComposer`).
2. Draft → runtime `agent: { mode: "draft", … }` + `privateClient` from TFY
   server handles.
3. Use builder port:
   - read-only lists from `getModels` / `getSkills` / `getMcp`
   - apply selection → `updateDraftSession` / runtime
     `useTrueFoundryUpdateAgentSpec` (already re-exported where available)
   - Save → `saveAgent({ agentName, agentSpec, draftSessionId? })`
4. Builder surface: hooks-first or minimal chrome (confirm before build) —
   still only in this SDK.

**Done when:** draft chat runs against inline spec; save calls host
`saveAgent` once.

**Verify:** example or tests with stub catalogs + stub `saveAgent`.

### Phase 4 — Docs + BYO guidance

1. Gateway path: `createTrueFoundryServer` + shell props.
2. BYO path (honest):
   - implement `AgentBuilderServer` fully
   - for chat: use TFY clients **or** provide `AgentChatServer` **plus**
     whatever the shell still needs to feed the runtime (document the gap:
     runtime is not abstracted)
3. Optional: in-memory stub for builder methods only.

**Done when:** README / this doc show both paths.

## Usage sketch (gateway-direct)

```tsx
const server = createTrueFoundryServer({
  apiKey: process.env.TFY_API_KEY!,
  baseUrl: process.env.TFY_GATEWAY_URL!,
  saveAgent: async ({ agentName, agentSpec }) => {
    // platform/BFF — promote draft AgentSpec → named agent
    return fetch('/api/agents', {
      method: 'POST',
      body: JSON.stringify({ name: agentName, spec: agentSpec }),
    }).then(r => r.json());
  },
  getModels: async () => [],
  getSkills: async () => [],
  getMcp: async () => [],
  searchAgents: async () => [],
});

<TrueForgeUI
  server={server}
  // omit agentConfig → AgentLibraryWithComposer (library + draft)
  // agentConfig={{ mode: "SingleAgent", name: "my-agent" }}
  layout="sidebar"
/>;
```

## BYO completeness checklist

### Catalog — complete for this UI

| UI call                     | Required response fields                                   |
| --------------------------- | ---------------------------------------------------------- |
| `getModels()`               | `name`, `provider`, `apiModel`, `modelId`                  |
| `getSkills()`               | `id`, `name`; `fqn?`, `description?`                       |
| `getMcp()`                  | `id`, `name`; `description?`                               |
| `searchAgents(req?)`        | `name`; optional display fields on `AgentLibraryEntry`     |
| `saveAgent` / `deleteAgent` | On port; **not called by UI yet** (optional until Save UI) |

### Chat — method list complete; standalone BYO is not

1. This UI does **not** call `server.*` chat methods. `TrueFoundryChatProvider`
   resolves `client` / `privateClient` for `useTrueFoundryAgentRuntime`.
2. Session returns are **behavioral** (methods), not plain JSON DTOs alone.
3. Stream/history events are full gateway unions: `TurnStreamData.event` →
   `TurnStreamingEvent`; history → `SessionEventItem`.
4. Draft `updateAgentSpec` in the runtime goes through `PrivateAgentSessionClient`
   → raw gateway `draftSessions.update`, **not** `server.updateDraftSession`.

**Must work for product chat (via gateway clients / compatible BFF):**
`createSession`, `listSessions`, `getSession`, `createTurn` (stream),
`cancelSession`, `listEvents`, `subscribeToTurn`, plus draft:
`createDraftSession`, `getDraftSession`, `listDraftSessions`,
`updateDraftSession` (port), `downloadSandboxFile` when sandbox downloads are
enabled.

**On the port but unused by this UI today:**
`listOwnedSessions`, non-stream `createTurn`, `deleteSession`,
`saveAgent`, `deleteAgent`.

### v1 BYO guidance

- **Builder:** implement `AgentBuilderServer` fully against your APIs (real BYO surface).
- **Chat:** point gateway clients at a gateway-compatible BFF, or use
  `createTrueFoundryServer`. Do not claim “replace chat with arbitrary REST” in v1.

## Usage sketch (bring your own backend)

Map your APIs into `AgentUIServer`. Chat method **request/response shapes** must
match gateway types (`AgentSession`, `AgentSpec`, `Turn`, …). Builder catalog
returns SDK-minimal `ModelEntry[]` / `AgentSkill[]` / `ConnectorState[]` (extend
via generics); `saveAgent` return is host-defined (`unknown`).

```tsx
import type {
  AgentUIServer,
  AgentSpec,
  AgentSession,
  AgentDraftSession,
  ModelEntry,
  AgentSkill,
  ConnectorState,
  AgentLibraryEntry,
} from '@truefoundry/trueforge-ui';
import {
  TrueForgeUI,
  // TFY path still needs gateway clients for the unchanged runtime:
  AgentSessionClient,
  PrivateAgentSessionClient,
} from '@truefoundry/trueforge-ui';

/**
 * Example: your REST/BFF is the source of truth for catalog + save,
 * and you adapt session CRUD to our chat port.
 *
 * v1 note: `@truefoundry/assistant-ui-runtime` still consumes
 * AgentSessionClient / PrivateAgentSessionClient. A common pattern is:
 *   - implement AgentBuilderServer fully against your APIs
 *   - for chat, either wrap gateway clients OR implement AgentChatServer
 *     and still pass gateway-shaped clients into the shell for streaming
 *   (see docs/server.md implication table)
 */
function createMyBackendServer(opts: {
  apiBase: string;
  getToken: () => string;
  /** Gateway clients used by the runtime for turn streaming (TFY-compatible). */
  gateway: {
    client: AgentSessionClient;
    privateClient: PrivateAgentSessionClient;
  };
}): AgentUIServer {
  const headers = () => ({
    Authorization: `Bearer ${opts.getToken()}`,
    'Content-Type': 'application/json',
  });

  const chatFromGateway: Pick<
    AgentUIServer,
    | 'createSession'
    | 'listSessions'
    | 'getSession'
    | 'createDraftSession'
    | 'getDraftSession'
    | 'listDraftSessions'
    | 'listOwnedSessions'
    | 'updateDraftSession'
    | 'createTurn'
    | 'cancelSession'
    | 'listTurns'
    | 'getTurn'
    | 'listEvents'
    | 'subscribeToTurn'
    | 'downloadSandboxFile'
  > = {
    // Thin-wrap gateway for chat (simplest BYO that still streams today).
    // Replace these bodies with fetch(opts.apiBase + …) once you map to gateway types.
    createSession: req => opts.gateway.client.createSession(req),
    listSessions: req => opts.gateway.client.listSessions(req),
    getSession: req => opts.gateway.client.getSession(req),
    createDraftSession: req => opts.gateway.privateClient.createDraftSession(req),
    getDraftSession: req => opts.gateway.privateClient.getDraftSession(req),
    listDraftSessions: req => opts.gateway.privateClient.listDraftSessions(req),
    listOwnedSessions: req => opts.gateway.privateClient.listOwnedSessions(req),
    updateDraftSession: async ({ draftSessionId, agentSpec }) => {
      const draft = await opts.gateway.privateClient.getDraftSession({
        draftSessionId,
      });
      await draft.update({ agentSpec });
      return draft;
    },
    createTurn: async function* (req) {
      const session =
        (await opts.gateway.client.getSession({ sessionId: req.sessionId }).catch(() => null)) ??
        (await opts.gateway.privateClient.getDraftSession({
          draftSessionId: req.sessionId,
        }));
      const prepared = session.prepareTurn({
        input: req.input,
        previousTurnId: req.previousTurnId,
      });
      if (req.stream === false) {
        yield await prepared.execute({
          stream: false,
          pollIntervalMs: req.pollIntervalMs,
        });
        return;
      }
      yield* prepared.execute({ stream: true });
    },
    cancelSession: async ({ sessionId }) => {
      const session = await opts.gateway.client.getSession({ sessionId });
      await session.cancel();
    },
    listTurns: async ({ sessionId, ...page }) => {
      const session = await opts.gateway.client.getSession({ sessionId });
      return session.listTurns(page);
    },
    getTurn: async ({ sessionId, turnId }) => {
      const session = await opts.gateway.client.getSession({ sessionId });
      return session.getTurn({ turnId });
    },
    listEvents: async ({ sessionId, ...page }) => {
      const session = await opts.gateway.client.getSession({ sessionId });
      return session.listEvents(page);
    },
    subscribeToTurn: async function* ({ sessionId, turnId, afterSequenceNumber }) {
      const session = await opts.gateway.client.getSession({ sessionId });
      const turn = await session.getTurn({ turnId });
      yield* turn.stream({ afterSequenceNumber });
    },
    downloadSandboxFile: (sandboxId, req) => opts.gateway.privateClient.downloadSandboxFile(sandboxId, req),
  };

  return {
    ...chatFromGateway,

    // --- fully your backend ---
    async getModels() {
      const res = await fetch(`${opts.apiBase}/catalog/models`, {
        headers: headers(),
      });
      return res.json() as Promise<ModelEntry[]>;
    },
    async getSkills() {
      const res = await fetch(`${opts.apiBase}/catalog/skills`, {
        headers: headers(),
      });
      return res.json() as Promise<AgentSkill[]>;
    },
    async getMcp() {
      const res = await fetch(`${opts.apiBase}/catalog/mcp`, {
        headers: headers(),
      });
      return res.json() as Promise<ConnectorState[]>;
    },
    async searchAgents(req) {
      const params = new URLSearchParams();
      if (req?.query) params.set('namePrefix', req.query);
      if (req?.limit != null) params.set('limit', String(req.limit));
      if (req?.offset != null) params.set('offset', String(req.offset));
      const res = await fetch(`${opts.apiBase}/agents?${params}`, {
        headers: headers(),
      });
      return res.json() as Promise<AgentLibraryEntry[]>;
    },
    async saveAgent({ agentName, agentSpec, draftSessionId }) {
      const res = await fetch(`${opts.apiBase}/agents`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({
          name: agentName,
          spec: agentSpec,
          draftSessionId,
        }),
      });
      if (!res.ok) throw new Error(await res.text());
      return res.json();
    },
  };
}

// App
const gatewayClient = new AgentSessionClient({
  apiKey: process.env.TFY_API_KEY!,
  baseUrl: process.env.TFY_GATEWAY_URL!,
});
const gatewayPrivate = new PrivateAgentSessionClient({
  apiKey: process.env.TFY_API_KEY!,
  baseUrl: process.env.TFY_GATEWAY_URL!,
});

const server = createMyBackendServer({
  apiBase: 'https://api.mycompany.com/v1',
  getToken: () => process.env.MY_API_TOKEN!,
  gateway: { client: gatewayClient, privateClient: gatewayPrivate },
});

export function App() {
  return (
    <TrueForgeUI
      server={server}
      agentConfig={{
        mode: 'AgentComposer',
        defaultAgentSpec: {
          model: { name: 'openai-main/gpt-4.1' },
          instructions: 'You are helpful.',
        } satisfies AgentSpec,
      }}
      layout="sidebar"
      theme={{
        preset: 'chatgpt',
        brand: {
          mode: 'logo',
          name: 'MyCo',
          icon: { src: '/myco-icon.svg' },
          logo: { src: '/myco-wordmark.svg' },
        },
      }}
    />
  );
}
```

**Pure custom chat (no gateway):** implement every `AgentChatServer` method so
return values satisfy gateway types (`AgentSession`, `Page<…>`,
`AsyncIterable<TurnStreamData>`, …). Until the runtime accepts `AgentChatServer`
directly, the shell still needs a path into `useTrueFoundryAgentRuntime` —
document that gap for hosts; v1 BYO strength is **builder + branding**, with
chat either on gateway or a compatible adapter.

## Non-goals (v1)

- Any PR to `@truefoundry/assistant-ui-runtime`
- Full BYO chat streaming without gateway-shaped clients
- Typed `saveAgent` response (stays `unknown` / host-defined)
- Multi-agent
- Publish flow beyond `saveAgent`
- Removing `tfy-web-components` / theming overhaul (separate track)

## PR sequence (all in this repo)

1. Types + `createTrueFoundryServer` + tests
2. `server` prop on provider / shell (named)
3. Draft `agentConfig` + builder / save wiring
4. Docs + examples (gateway + BYO stub for builder)

## Open before Phase 3

- Builder surface: **hooks-only** vs **in-package minimal UI**
