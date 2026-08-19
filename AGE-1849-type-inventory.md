# OpenAPI type inventory (AGE-1849)

Rename AgentSpec nested OpenAPI types so they are not parent-prefixed, and align picker / settings / catalog type names with skills and MCP.

JSON field names and HTTP paths are unchanged. Fern/SDK regeneration publishes these names.

## AgentSpec nested types

| Field         | Before                 | After                                    |
| ------------- | ---------------------- | ---------------------------------------- |
| `model`       | `AgentSpecModel`       | `Model`                                  |
| `messages`    | `AgentSpecUserMessage` | `UserMessage` (existing turn-input type) |
| `skills`      | `SkillNameRef`         | `Skill`                                  |
| `mcp_servers` | `MCPServer`            | `MCPServer` (unchanged)                  |

## Resource views (* changed in this PR)

| Resource         | Settings                        | Chat picker                                                  | Catalog                    |
| ---------------- | ------------------------------- | ------------------------------------------------------------ | -------------------------- |
| Skill            | `ConfiguredSkill`               | `SkillReadEntry` / `ListAvailableSkillsResponse`             | `CatalogSkill`             |
| MCP              | `* ConfiguredMCPServer`         | `* MCPServerReadEntry` / `* ListAvailableMCPServersResponse` | `* CatalogMCPServer`       |
| Model            | —                               | `* ModelReadEntry` / `* ListAvailableModelsResponse`         | —                          |
| Model provider   | `* ConfiguredModelProvider`     | —                                                            | `CatalogModelProvider`     |
| Sandbox provider | `* ConfiguredSandboxProvider`   | —                                                            | `* CatalogSandboxProvider` |
| Agent            | `Agent` (`manifest: AgentSpec`) | —                                                            | —                          |

Also: `MeResponse` → `GetMeResponse`. MCP settings/catalog/API names `Mcp*` → `MCP*` (`MCPServerType`, `MCPServerManifest`, `CreateMCPServerRequest`, `ListMCPServerToolsResponse`, …).

## Summary table (one row per resource)

| Resource         | Spec mount      | Stored document           | Settings row                | Create                       | Replace                     | Get                          | List                         | Picker item          | Picker list                       | Catalog item             | Catalog response                    |
| ---------------- | --------------- | ------------------------- | --------------------------- | ---------------------------- | --------------------------- | ---------------------------- | ---------------------------- | -------------------- | --------------------------------- | ------------------------ | ----------------------------------- |
| Agent            | —               | `AgentSpec`               | `Agent`                     | `CreateAgentRequest`         | `PutAgentRequest`           | `GetAgentResponse`           | `ListAgentsResponse`         | —                    | —                                 | —                        | —                                   |
| MCP server       | `MCPServer`     | `MCPServerManifest`       | `ConfiguredMCPServer`       | `CreateMCPServerRequest`     | `PutMCPServerRequest`       | `GetMCPServerResponse`       | `ListMCPServersResponse`     | `MCPServerReadEntry` | `ListAvailableMCPServersResponse` | `CatalogMCPServer`       | `GetMCPServerCatalogResponse`       |
| Skill            | `Skill`         | `SkillManifest`           | `ConfiguredSkill`           | `CreateSkillRequest`         | `PutSkillRequest`           | `GetSkillResponse`           | `ListSkillsResponse`         | `SkillReadEntry`     | `ListAvailableSkillsResponse`     | `CatalogSkill`           | `GetSkillCatalogResponse`           |
| Model            | `Model`         | —                         | —                           | —                            | —                           | —                            | —                            | `ModelReadEntry`     | `ListAvailableModelsResponse`     | —                        | —                                   |
| Model provider   | —               | `ModelProviderManifest`   | `ConfiguredModelProvider`   | `CreateModelProviderRequest` | `PutModelProviderRequest`   | `GetModelProviderResponse`   | `ListModelProvidersResponse` | —                    | —                                 | `CatalogModelProvider`   | `GetModelProviderCatalogResponse`   |
| Sandbox provider | `SandboxConfig` | `SandboxProviderManifest` | `ConfiguredSandboxProvider` | —                            | `PutSandboxProviderRequest` | `GetSandboxProviderResponse` | —                            | —                    | —                                 | `CatalogSandboxProvider` | `GetSandboxProviderCatalogResponse` |
| Session          | —               | —                         | `Session`                   | `CreateSessionRequest`       | `UpdateSessionRequest`      | `GetSessionResponse`         | `ListSessionsResponse`       | —                    | —                                 | —                        | —                                   |
| Turn             | —               | —                         | `Turn`                      | `CreateTurnRequest`          | —                           | `GetTurnResponse`            | `ListTurnsResponse`          | —                    | —                                 | —                        | —                                   |

Blank cells are endpoints that do not exist, not missing types. Sandbox provider is one-per-tenant, so it has `Put` + `Get` only.

## All types in `openapi.json` (flat)

- ActionRequiredEvent
- Agent
- AgentInfo
- AgentParent
- AgentSpec
- AlibabaModelProvider
- AnthropicModelProvider
- ApprovalAllow
- ApprovalDecision
- ApprovalDeny
- AskUserQuestionsConfig
- BaseMCPAuthRequiredEvent
- BaseThreadDoneEvent
- CancelSessionRequest
- CancelSessionResponse
- CatalogCustomModelProvider
- CatalogMCPServer
- CatalogModelProvider
- CatalogSandboxProvider
- CatalogSkill
- CatalogWellKnownModelProvider
- CatalogWellKnownModelProviderType
- ChatCompletionChunkDeltaToolCall
- ChatCompletionContentPartRefusal
- ChatCompletionContentPartText
- ChatCompletionMessageToolCall
- ConfiguredMCPServer
- ConfiguredModelProvider
- ConfiguredSandboxProvider
- ConfiguredSkill
- ContextManagementConfig
- CreateAgentRequest
- CreateMCPServerRequest
- CreateModelProviderRequest
- CreateSessionAgent
- CreateSessionRequest
- CreateSkillRequest
- CreateTurnRequest
- CustomModelProvider
- DaytonaSandboxProviderAuth
- DeleteAgentResponse
- DynamicSubAgentsConfig
- ExtendedChunkDeltaToolCall
- FileContent
- FinishReason
- FireworksModelProvider
- GenerativeUIConfig
- GetAgentResponse
- GetCapabilitiesResponse
- GetMCPServerCatalogResponse
- GetMCPServerResponse
- GetMeResponse
- GetModelProviderCatalogResponse
- GetModelProviderResponse
- GetSandboxProviderCatalogResponse
- GetSandboxProviderResponse
- GetSessionResponse
- GetSkillCatalogResponse
- GetSkillResponse
- GetTurnResponse
- GoogleGeminiModelProvider
- LargeToolResponseConfig
- ListAgentsResponse
- ListAvailableMCPServersResponse
- ListAvailableModelsResponse
- ListAvailableSkillsResponse
- ListMCPServerToolsResponse
- ListMCPServersResponse
- ListModelProvidersResponse
- ListSessionEventsResponse
- ListSessionsOrder
- ListSessionsResponse
- ListSkillsResponse
- ListTurnEventsOrder
- ListTurnEventsResponse
- ListTurnsResponse
- MCPAuthRequiredEvent
- MCPAuthStatus
- MCPInitializeEvent
- MCPServer
- MCPServerAuthInfo
- MCPServerAuthPublic
- MCPServerDcrAuth
- MCPServerHeaderAuth
- MCPServerInitInfo
- MCPServerManifest
- MCPServerManifestAuth
- MCPServerReadEntry
- MCPServerType
- MCPToolInfo
- Model
- ModelEntry
- ModelListProvider
- ModelMessageDeltaEvent
- ModelMessageEvent
- ModelMessageUsage
- ModelParams
- ModelProperties
- ModelProviderAuth
- ModelProviderManifest
- ModelReadEntry
- MoonshotModelProvider
- OpenAIModelProvider
- PreviousTurnIdInput
- PutAgentRequest
- PutMCPServerRequest
- PutModelProviderRequest
- PutSandboxProviderRequest
- PutSkillRequest
- RawToolCall
- ReasoningEffort
- RequestErrorResponse
- ResourceName
- ResponseFormat
- ResponseFormatJsonObject
- ResponseFormatJsonSchema
- ResponseFormatText
- RuntimeConfig
- SandboxBuildStatus
- SandboxConfig
- SandboxCreatedEvent
- SandboxNetworkPolicy
- SandboxProviderManifest
- Session
- SessionAgent
- SessionAgentInline
- SessionAgentNameRef
- SessionAgentReference
- SessionAgentSpecBody
- SessionEvent
- SessionEventItem
- Skill
- SkillManifest
- SkillReadEntry
- SkillType
- TextContent
- ThreadCreatedEvent
- ThreadDoneEvent
- ThreadState
- ThreadStateDone
- ThreadStateError
- TogetherAIModelProvider
- TokenPagination
- ToolApprovalRequiredEvent
- ToolCall
- ToolCallRef
- ToolInfo
- ToolResponseEvent
- ToolResponseRequiredEvent
- TrueFoundrySystemToolInfo
- Turn
- TurnCreatedEvent
- TurnDoneEvent
- TurnInputItem
- TurnMetrics
- TurnState
- TurnStateCancelled
- TurnStateCancelledReason
- TurnStateDone
- TurnStateError
- TurnStateRunning
- TurnStreamingEvent
- UpdateSessionRequest
- UserMessage
- UserMessageContentItem
- UserToolApprovalEvent
- UserToolResponseEvent
- ZaiModelProvider

## All types in `openapi.json`, by resource

### Auth

- GetMeResponse

### Agents

- Agent
- AgentSpec
- CreateAgentRequest
- PutAgentRequest
- GetAgentResponse
- ListAgentsResponse
- DeleteAgentResponse

### AgentSpec nested

- Model
- ModelParams
- UserMessage
- MCPServer
- Skill
- ResponseFormat
- ResponseFormatText
- ResponseFormatJsonObject
- ResponseFormatJsonSchema
- RuntimeConfig
- SandboxConfig
- SandboxNetworkPolicy
- DynamicSubAgentsConfig
- ContextManagementConfig
- LargeToolResponseConfig
- GenerativeUIConfig
- AskUserQuestionsConfig

### Sessions

- Session
- SessionAgent
- SessionAgentInline
- SessionAgentReference
- SessionAgentNameRef
- SessionAgentSpecBody
- CreateSessionAgent
- CreateSessionRequest
- UpdateSessionRequest
- GetSessionResponse
- ListSessionsResponse
- ListSessionsOrder
- CancelSessionRequest
- CancelSessionResponse

### Turns

- Turn
- TurnInputItem
- TurnState
- TurnStateRunning
- TurnStateDone
- TurnStateError
- TurnStateCancelled
- TurnStateCancelledReason
- TurnMetrics
- PreviousTurnIdInput
- CreateTurnRequest
- GetTurnResponse
- ListTurnsResponse
- ListTurnEventsOrder

### Events

- SessionEvent
- SessionEventItem
- TurnStreamingEvent
- TurnCreatedEvent
- TurnDoneEvent
- ListSessionEventsResponse
- ListTurnEventsResponse
- UserMessage
- UserMessageContentItem
- TextContent
- FileContent
- UserToolApprovalEvent
- UserToolResponseEvent
- ApprovalAllow
- ApprovalDeny
- ApprovalDecision
- ModelMessageEvent
- ModelMessageDeltaEvent
- ModelMessageUsage
- ToolCall
- RawToolCall
- ToolInfo
- MCPToolInfo
- TrueFoundrySystemToolInfo
- ToolCallRef
- ToolApprovalRequiredEvent
- ToolResponseRequiredEvent
- ToolResponseEvent
- ActionRequiredEvent
- ThreadCreatedEvent
- ThreadDoneEvent
- ThreadState
- ThreadStateDone
- ThreadStateError
- AgentInfo
- AgentParent
- BaseThreadDoneEvent
- MCPAuthRequiredEvent
- BaseMCPAuthRequiredEvent
- MCPServerAuthInfo
- MCPInitializeEvent
- MCPServerInitInfo
- SandboxCreatedEvent

### Models + model providers

- ConfiguredModelProvider
- ModelProviderManifest
- ModelProviderAuth
- ModelEntry
- ModelProperties
- ReasoningEffort
- CreateModelProviderRequest
- PutModelProviderRequest
- GetModelProviderResponse
- ListModelProvidersResponse
- ModelReadEntry
- ModelListProvider
- ListAvailableModelsResponse
- CatalogModelProvider
- CatalogWellKnownModelProvider
- CatalogWellKnownModelProviderType
- CatalogCustomModelProvider
- GetModelProviderCatalogResponse
- OpenAIModelProvider
- AnthropicModelProvider
- GoogleGeminiModelProvider
- FireworksModelProvider
- ZaiModelProvider
- MoonshotModelProvider
- AlibabaModelProvider
- TogetherAIModelProvider
- CustomModelProvider

### MCP

- MCPServer
- ConfiguredMCPServer
- MCPServerManifest
- MCPServerType
- MCPServerManifestAuth
- MCPServerHeaderAuth
- MCPServerDcrAuth
- MCPAuthStatus
- CreateMCPServerRequest
- PutMCPServerRequest
- GetMCPServerResponse
- ListMCPServersResponse
- MCPServerReadEntry
- MCPServerAuthPublic
- ListAvailableMCPServersResponse
- CatalogMCPServer
- GetMCPServerCatalogResponse
- ListMCPServerToolsResponse

### Skills

- Skill
- ConfiguredSkill
- SkillManifest
- SkillType
- CreateSkillRequest
- PutSkillRequest
- GetSkillResponse
- ListSkillsResponse
- SkillReadEntry
- ListAvailableSkillsResponse
- CatalogSkill
- GetSkillCatalogResponse

### Sandboxes

- ConfiguredSandboxProvider
- SandboxProviderManifest
- DaytonaSandboxProviderAuth
- SandboxBuildStatus
- PutSandboxProviderRequest
- GetSandboxProviderResponse
- CatalogSandboxProvider
- GetSandboxProviderCatalogResponse

### LLM passthrough (in public OpenAPI via event $refs)

- FinishReason
- ToolCall
- RawToolCall
- ExtendedChunkDeltaToolCall
- ChatCompletionChunkDeltaToolCall
- ChatCompletionMessageToolCall
- ChatCompletionContentPartText
- ChatCompletionContentPartRefusal

### Shared

- ResourceName
- TokenPagination
- RequestErrorResponse
- GetCapabilitiesResponse

## Not in `openapi.json` (`.openapi()` in source only)

These have `.openapi('…')` in TypeScript but never appear under `components.schemas`.

### Query / path helpers (Hono inlines; no `$ref`)

- DownloadSandboxFileRequestQuery
- ListSessionEventsRequestQuery
- ListSessionsRequestQuery
- ListTurnEventsRequestQuery
- ListTurnsRequestQuery
- ModelProviderType
- SubscribeTurnQuery

### Core / runtime only

Wire shape for thread metrics is `TurnMetrics`; `AgentThreadMetrics` is the internal accumulator.

- AgentThreadMetrics
- ChatCompletionAssistantMessageParam
- ChatCompletionChunkDelta
- ChatCompletionChunkFinishReason
- ChatCompletionContentPartFile
- ChatCompletionContentPartImage
- ChatCompletionContentPartInputAudio
- ChatCompletionToolMessageParam
- ChatCompletionUserMessageParam
- CompletionUsage
- CurrentContextUsage
- EnrichedAssistantMessage
- ExtendedChunkDelta
- LLMToolMessage
- LLMUserMessage
- RawAssistantMessage
- RedactedThinkingBlock
- ThinkingBlock

## Coverage

Checked-in `.github/fern/openapi/openapi.json` may still be pre-rename; lists above use post-rename names. CI regenerates the spec. Final counts are in **Count summary** below.

## Inconsistencies this PR fixes

| Before                          | After                          |
| ------------------------------- | ------------------------------ |
| `AgentSpecModel`                | `Model`                        |
| `AgentSpecUserMessage`          | `UserMessage`                  |
| `SkillNameRef`                  | `Skill`                        |
| picker `Model`                  | `ModelReadEntry`               |
| `ListModelsResponse`            | `ListAvailableModelsResponse`  |
| settings `ModelProvider`        | `ConfiguredModelProvider`      |
| settings `SandboxProvider`      | `ConfiguredSandboxProvider`    |
| `CatalogDaytonaSandboxProvider` | `CatalogSandboxProvider`       |
| `MeResponse`                    | `GetMeResponse`                |
| settings/catalog `McpServer*`   | `MCPServer*` / `MCPAuthStatus` |

## Inconsistencies that still exist

| #   | What                                                                                                                                                                                           | Why it is inconsistent                                                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Settings rows are `ConfiguredSkill` / `ConfiguredMCPServer` / `ConfiguredModelProvider` / `ConfiguredSandboxProvider`, but saved agents are `Agent` (not `ConfiguredAgent`)                    | Same layer (settings/admin CRUD item) uses two naming patterns. Agents also carry identity (`id`, `name`) plus `manifest`, so they look more like a first-class resource than a “configured connector.” |
| 2   | Three model objects: `Model` (AgentSpec: `name` + `params`), `ModelEntry` (inside a provider manifest), `ModelReadEntry` (picker row)                                                          | Same English word, three wire shapes. Easy to import the wrong one; only `ModelReadEntry` matches the `*ReadEntry` picker convention.                                                                   |
| 3   | AgentSpec mount is `Skill` / `MCPServer`, but settings documents are `SkillManifest` / `MCPServerManifest`                                                                                     | Organic and useful (mount vs stored config), but the short name `Skill` / `MCPServer` reads like the full resource. Callers must learn “spec mount ≠ settings row.”                                     |
| 4   | `SessionAgentNameRef` still ends in `NameRef` after `SkillNameRef` → `Skill`                                                                                                                   | Leftover from the old “name-only ref” pattern this PR removed for skills.                                                                                                                               |
| 5   | Catalog list envelopes are `GetFooCatalogResponse`, not `ListCatalogFoosResponse`                                                                                                              | Conflicts with `packages/trueforge/AGENTS.md` (`ListCatalogFoosResponse` / item `CatalogFoo`). Today every catalog is a single GET of the whole catalog blob.                                           |
| 6   | Catalog model providers split into `CatalogWellKnownModelProvider` + `CatalogCustomModelProvider` (+ union `CatalogModelProvider`), while MCP/skill/sandbox catalogs are a single `CatalogFoo` | Model catalogs need a discriminator; others do not. Asymmetric but driven by shape, not naming drift.                                                                                                   |
| 7   | Sandbox provider has `Put` + `Get` only (no `Create` / `List` / `Delete` types)                                                                                                                | One-per-tenant resource. Path stays plural for URL consistency; schema surface does not match multi-item settings resources.                                                                            |
| 8   | Only agents expose `DeleteAgentResponse` in the schema set                                                                                                                                     | Skills/MCP/model providers may delete via routes, but there is no parallel empty `DeleteFooResponse` schema family for them in this inventory (or deletes are not typed the same way).                  |
| 9   | Sessions use `UpdateSessionRequest`; settings resources use `PutFooRequest`                                                                                                                    | Sessions are partial/patch-style agent reassignment; settings are full manifest replace. Verb mismatch is intentional but looks uneven next to agents’ `PutAgentRequest`.                               |
| 10  | `CreateSessionAgent` is a union type name, not `CreateSessionRequest`’s nested field type with a clearer owner                                                                                 | Sits beside `SessionAgent`, `SessionAgentInline`, `SessionAgentNameRef`, `SessionAgentReference`, `SessionAgentSpecBody` — five “session agent” names for create vs stored vs reference shapes.         |
| 11  | AgentSpec `messages` is typed as `UserMessage` (string **or** file parts) but refined to string-only content                                                                                   | Type says files are allowed; runtime/schema refine rejects non-strings. Spec and turn input share a name with different effective constraints.                                                          |
| 12  | No picker for model **providers** or sandbox providers (`ListAvailable*` only for skills, MCP, models)                                                                                         | Chat composer needs models/skills/MCP; providers are settings-only. Fine product-wise; the resource matrix looks gappy.                                                                                 |
| 13  | `ModelListProvider` is a tiny `{ name }` nest on `ModelReadEntry`, not reused as a shared “provider ref” elsewhere                                                                             | One-off name; similar to a NameRef but not called one.                                                                                                                                                  |
| 14  | OpenAPI says `MCPServer` / `TogetherAIModelProvider`; Fern TS emits `McpServer` / `TogetherAiModelProvider`                                                                                    | Fern’s acronym/casing rules, not our schema names. SDK imports disagree with OpenAPI titles.                                                                                                            |
| 15  | Anonymous nested objects become Fern types: `McpServerEnableToolsItem`, `ContextManagementConfigCompaction`, `SandboxNetworkPolicyAuthInjectItem*`, `GetCapabilitiesResponseDataSkill`, …      | AGENTS.md says extract nested objects to named `.openapi('…')` schemas. These never got names, so Fern invents them from path.                                                                          |
| 16  | 25 source `.openapi('…')` names never appear in `components.schemas` (7 query helpers + 18 core/runtime)                                                                                       | Query schemas are inlined by Hono; core types (`AgentThreadMetrics`, `ThinkingBlock`, …) are never `$ref`’d from a route. Dead OpenAPI titles / inventory noise.                                        |
| 17  | `AgentThreadMetrics` (internal) vs wire `TurnMetrics`                                                                                                                                          | Two metrics types; only `TurnMetrics` is public. Easy to confuse when reading core vs API.                                                                                                              |
| 18  | `CancelSessionRequest` / `CancelSessionResponse` live under turn routes/schemas naming-wise but cancel a **session**                                                                           | Resource in the name ≠ package file ownership; discoverability cost.                                                                                                                                    |
| 19  | Auth is `GetMeResponse` (verb+resource) while most gets are `GetFooResponse` for collection items — fine — but there is no `Me` resource type, only the response envelope                      | Slightly special-cased compared to `{ data: Foo }` item pattern (me returns the user object at the top level / different shape).                                                                        |
| 20  | Checked-in `openapi.json` / SDK source can lag schema renames until CI regen                                                                                                                   | Local `packages/trueforge-sdk` may still export `MeResponse`, `SkillNameRef`, `AgentSpecModel` while Zod already uses the new names → consumer typecheck failures mid-PR.                               |

## Count summary

| Bucket                                              | Count | Notes                                                                      |
| --------------------------------------------------- | ----: | -------------------------------------------------------------------------- |
| `openapi.json` schemas (checked-in, pre-rename)     |   169 | `.github/fern/openapi/openapi.json` `components.schemas`                   |
| Public types in this inventory (post-rename unique) |   168 | 1 fewer than checked-in (`AgentSpecUserMessage` merges into `UserMessage`) |
| Source `.openapi('…')` names                        |   192 | `packages/trueforge` + `packages/trueforge-core`                           |
| Not in `openapi.json`                               |    25 | Source names with no `components.schemas` entry                            |
| └ Query / path helpers                              |     7 | Hono inlines; no `$ref`                                                    |
| └ Core / runtime only                               |    18 | Never registered on a public route                                         |
