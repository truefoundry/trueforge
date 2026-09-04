# Changelog

## 0.3.0-rc.1

### Minor Changes

- d269b01: Add a live advanced agent configuration drawer with shared model, runtime, MCP tool, skill, and Save Agent editors.
- e74e953: Keep agent configuration visible on the left in full-width builder layouts, make mobile config overlays closable, save the current instruction draft, align builder chrome, and preserve open widgets across chat runtime changes.
- a189482: Add routed agent detail pages with lazy Overview, Sessions, and Use In Code tabs backed by the optional AgentSessionsServer port and built-in TrueForge adapter.
- 8491843: Add a slot-driven agent Metrics tab with aggregate cards, time-range filtering, and Harness-backed line charts.
- a189482: Add the agent library Sessions tab and an all-user Sessions sidebar page (including drafts) with agent and time filters, shareable query params, and the same two-pane timeline. Library agent details keep the active tab in `?tab=` so opening an agent lands on Overview.
- 860e322: Split New Chat vs New Agent: simple chat keeps the Connectors/Skills picker; New Agent keeps Agent Config + Save Agent. Session metadata `is_create_agent` drives resume from the sessions browser.
- 0cc59f8: Wire schedule test runs and show last five run status chips on the schedules table. Bump `@truefoundry/assistant-ui-runtime` to `0.1.25`.
- 0cc59f8: Add global Schedules page at `/schedules` with listing, popover-based filters, and create/edit drawer wired to the schedule API. New schedules save as paused, open a Test Schedule review with MCP connect status, and support Activate Anyway. List schedules uses server token pagination and multi-agent filters. Agents shows a Schedules count column (warning when any are paused) loaded via a batched list for on-screen agents. Add Table primitives with client-side and token pagination plus portal DropdownMenu so row actions are not clipped by overflow. Export a reusable popover select with single- and multi-select modes.
- 788636d: Sidebar layout is a permanent icon+label nav rail (no expand/collapse). Recent chats are hidden from the sidebar and mobile drawer; the drawer shows nav actions only.
- 8f1a2dc: Add a TrueFoundry-managed model registry. When `TRUEFOUNDRY_SERVICEFOUNDRY_SERVER_URL` is set, models are listed from the TrueFoundry ServiceFoundry server and turns are routed through the tenant's default AI Gateway with the caller's token. Mutually exclusive with OIDC. Supports internal mutual TLS to the ServiceFoundry server via `TRUEFOUNDRY_MTLS_ENABLED`/`TRUEFOUNDRY_MTLS_CERTS_DIR`.

### Patch Changes

- 347a7e7: Refresh composer and composer-trigger styling: 0.75rem composer corners with a light-theme primary-token gradient hairline (faded top → solid bottom) and a neutral hairline in dark, an icon-only tools trigger in place of the "Tools" caption and count badge, the shared `agent-2` glyph on the agents-library trigger, and squared-off chrome-action geometry on the save-agent trigger. Also fixes `agent-2.svg` to use `currentColor` so it is legible in dark mode.
- a189482: Load agent Use In Code snippets through `client.internal.agents.getCodeSnippets` instead of a raw `client.fetch`.
- c4ee138: Agent list and details overflow menu: Edit, Clone (`{name}-copy` via saveAgent), Manage Schedules, and Delete (wired through harness `deleteAgent`).
- c4ee138: AgentSessions list pane uses a quieter surface, and the resize grip stays gray until hover, press, or focus.
- c4ee138: Agent Code (`SyntaxHighlighter` / `AgentCodeBlock`) copy control uses the bordered secondary button, and a trailing source newline no longer paints an empty last line while Copy still keeps the exact source.
- c4ee138: Agents, Sessions, and Schedules empty states use a shared centered empty-box screen with title and supporting copy.
- 0cc59f8: Use Google Sans as the default `trueforge` theme font and load it from Google Fonts when styles are injected.
- 64ca089: Hide Clear chat while the thread is fresh (New Chat, New Agent, and Try Agent) since there is nothing to clear.
- 64ca089: Add a book-icon preload toggle and dashed add button to Agent Config MCP server pills.
- d269b01: Improve MCP and skill selectors with consistent search sizing, explicit MCP selection controls, grouped tool summaries, and removable MCP chips.
- 64ca089: Revamp the MCP tools selector modal with focus rows, connect empty state, and grouped selected-tools summary.
- c4ee138: Resume Chat / Resume Agent building opens in a new tab when routed (`/sessions/:id` + square-arrow-out-up-right); without a router it keeps the in-shell resume fallback.
- 788636d: Open the create schedule drawer when Agents "+ Schedule" navigates with `isNew=true`, then clear the flag from the URL.
- 333230d: Improve Agent Sessions with a resizable divider, accurate turn grouping, optional cost display, and reliable timeline tooltips with sub-agent details. Simplify schedule recurrence and default new schedules to the local timezone.
- c4ee138: Unregister the `/settings` route when Settings chrome is unavailable (no catalog or `capabilities.settings.enabled` is false), matching the sidebar Settings button gate.
- c4ee138: Split New Chat and New Agent draft preference stores. New Chat remembers only model (+ reasoning), skills, and MCP; New Agent keeps the full seed including runtime config.
- 4c1260e: Wire TrueFoundry MCP authorize, status, and delete through ServiceFoundry; stub list auth_status; gate oauth2 invoke mid-turn with authRequired; paginate MCP server lists. UI treats SFY consent `code`/`error` on the FE landing like local DCR success/failure.
- c4ee138: Per-turn Tokens in Agent Sessions shows a keyboard-accessible Input / Output / Cached tooltip (Input is uncached).
- Updated dependencies [648273b]
- Updated dependencies [648273b]
- Updated dependencies [52987a7]
- Updated dependencies [38ce068]
- Updated dependencies [b654052]
- Updated dependencies [4c1260e]
- Updated dependencies [f175245]
  - @truefoundry/trueforge-sdk@0.1.4-rc.1

## 0.3.0-rc.0

### Minor Changes

- 3539da2: Add `brand.mode` (`icon-title` | `icon-only` | `logo`) so hosts pick chrome look first; `name` always labels the mark, and `resolveBrandChrome` maps mode to layout chrome.
- 16feb29: Add `customActionRenderers` so hosts can pause the composer on client-side tools with their own UI and resume via `onSubmit(content)`.
- 0297727: Add context-management compaction triggers with model-aware defaults and migrate persisted legacy token thresholds.

### Patch Changes

- b11cfc3: Wire remote chat session deletion and improve the history delete action styling.
- 3ca4e2e: fixed the button component icon and padding, delete conflicting local prettier.json in trueforge-ui package
- a655537: Update published dependency ranges (AI SDK, Hono, MCP SDK, Redis, assistant-ui, and related packages).
- aa4be44: Open markdown links in assistant messages in a new tab
- d7015fd: show mcp server tool name on tool approval
- Updated dependencies [648273b]
  - @truefoundry/trueforge-sdk@0.1.4-rc.0

## Unreleased

### Minor Changes

- **`brand.mode`** — explicit chrome look. Set `mode`, then pass the fields it requires.
  `name` always labels the mark (`alt` / `aria-label`):
  - **`'icon-title'`** — `name` + optional `icon` (title shown in expanded chrome)
  - **`'icon-only'`** — `name` + `icon` (alt kept, no title text)
  - **`'logo'`** — `name` + `icon` + `logo` (wordmark in expanded chrome; `name` is alt only)
  - **Default** — omit `brand` for the TrueForge wordmark / square mark
- **`resolveBrandChrome()`** — maps `brand.mode` to
  `{ expandedVariant, collapsedVariant, showTitle }`. `SidebarLayout` uses it; custom
  layouts should too.

### Changed

- **`BrandConfig`** — discriminated on `mode` (`BrandMode`). Removed `showTitle` from
  config; visible title follows the mode.

## 0.2.4

### Patch Changes

- f1c5c6b: Fall back to the pending MCP authorization URL when the UI server does not expose a catalog.

## 0.2.3

### Patch Changes

- abd9e38: Agents Library rows: show connectors before skills, use the composer's lightbulb icon for skills, and reveal the connector/skill names in a tooltip on hover.
- cc49d4a: Rename catalog, sandbox-file download, and MCP tools paths; Fern upsert becomes create_or_update. Sessions and turns default and max 25; session and turn event lists default and max 100.
- d7a640f: Align OpenAPI type names across AgentSpec, settings, catalogs, and chat pickers: Catalog/Configured/Available resource views, AgentSpec nested Model/Skill/InitialUserMessage, Put*Request → Update*Request, MCP acronym casing, GetMeResponse, and explicit names for nested AgentSpec/capabilities schemas.
- 7e2e02c: Refresh composer catalogs whenever settings close, including navigating to a chat or named agent.
- Updated dependencies [cc49d4a]
  - @truefoundry/trueforge-sdk@0.1.3

## 0.2.3-rc.0

### Patch Changes

- abd9e38: Agents Library rows: show connectors before skills, use the composer's lightbulb icon for skills, and reveal the connector/skill names in a tooltip on hover.
- cc49d4a: Rename catalog, sandbox-file download, and MCP tools paths; Fern upsert becomes create_or_update. Sessions and turns default and max 25; session and turn event lists default and max 100.
- d7a640f: Align OpenAPI type names across AgentSpec, settings, catalogs, and chat pickers: Catalog/Configured/Available resource views, AgentSpec nested Model/Skill/InitialUserMessage, Put*Request → Update*Request, MCP acronym casing, GetMeResponse, and explicit names for nested AgentSpec/capabilities schemas.
- 7e2e02c: Refresh composer catalogs whenever settings close, including navigating to a chat or named agent.
- Updated dependencies [cc49d4a]
  - @truefoundry/trueforge-sdk@0.1.3-rc.0

## 0.2.2

### Patch Changes

- 3113aa4: Rename the MCP servers SDK method from `deleteAuthorize` to `deleteAuthorization`.
- 45dc6cd: Replace MCP authorize `redirect_url` with a same-origin `return_to` path to prevent open redirects after OAuth.
- Updated dependencies [3113aa4]
- Updated dependencies [45dc6cd]
  - @truefoundry/trueforge-sdk@0.1.2

## 0.2.1

### Patch Changes

- c5223ad: Ship `react-dom` and `react-router-dom` as package dependencies instead of peers so consumers no longer need to install them separately.
- 92ee970: Decode common escape sequences (`\n`, `\t`, `\r`, `\uXXXX`, …) in user-facing API error messages and render them with `whitespace-pre-wrap` so multi-line Zod validation output displays correctly.
- 53104b1: Keep active and remembered draft sandbox settings synchronized with server capabilities.

## 0.2.0

### Minor Changes

- 9a4d1a7: Add opt-in `withRouter` URL sync for shell places (`/`, `/agents/:agentName`, `/sessions/:sessionId`, `/settings`), with path customization via `routes` and `react-router-dom` as an optional peer. Serve the app shell for client-side deep links from the TrueForge server.

### Patch Changes

- Updated dependencies [5100c59]
  - @truefoundry/trueforge-sdk@0.1.1

## 0.1.0

### Minor Changes

- 2f08a99: Remember plain-draft composer choices (model, skills, MCP connectors, config) across New Chat and reloads via localStorage. Edit-flow and immutable library agents are unchanged. `TrueForgeUI` `layout` is optional and defaults to `"sidebar"`.
- b56c003: Initial 0.1.0-rc.1 prerelease of all public packages.

### Patch Changes

- e9bf976: Wrap settings MCP, skills, model-provider, and sandbox create/put bodies as `{ manifest }`. List/get items nest the stored document (`name` plus `manifest`, plus derived fields). Create returns 201. Chat lists and catalogs stay flat. Adapter catalogs follow the new SDK shapes.
- a9e8187: Improve nested tool approval handling and bump `@truefoundry/assistant-ui-runtime`.
- 0730213: Save Agent dialog: add a per-connector **preload** toggle (writes `mcp_servers[].preload`), render the capabilities as side-by-side cards, and declutter the modal — inline model/connector/skill chips (model shows its provider logo), the "Connectors" label, no subtitle, content-sized height, and tighter spacing. Tooltips now portal into the nearest `<dialog>` so they render above modal content.
- Updated dependencies [e9bf976]
- Updated dependencies [b56c003]
  - @truefoundry/trueforge-sdk@0.1.0

## 0.1.0-rc.2

### Minor Changes

- 2f08a99: Remember plain-draft composer choices (model, skills, MCP connectors, config) across New Chat and reloads via localStorage. Edit-flow and immutable library agents are unchanged. `TrueForgeUI` `layout` is optional and defaults to `"sidebar"`.

### Patch Changes

- a9e8187: Improve nested tool approval handling and bump `@truefoundry/assistant-ui-runtime`.
- 0730213: Save Agent dialog: add a per-connector **preload** toggle (writes `mcp_servers[].preload`), render the capabilities as side-by-side cards, and declutter the modal — inline model/connector/skill chips (model shows its provider logo), the "Connectors" label, no subtitle, content-sized height, and tighter spacing. Tooltips now portal into the nearest `<dialog>` so they render above modal content.

## 0.1.0-rc.1

### Patch Changes

- e9bf976: Wrap settings MCP, skills, model-provider, and sandbox create/put bodies as `{ manifest }`. List/get items nest the stored document (`name` plus `manifest`, plus derived fields). Create returns 201. Chat lists and catalogs stay flat. Adapter catalogs follow the new SDK shapes.
- Updated dependencies [e9bf976]
  - @truefoundry/trueforge-sdk@0.1.0-rc.1

## 0.1.0-rc.0

### Minor Changes

- b56c003: Initial 0.1.0-rc.1 prerelease of all public packages.

### Patch Changes

- Updated dependencies [b56c003]
  - @truefoundry/trueforge-sdk@0.1.0-rc.0

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **`@truefoundry/assistant-ui-runtime` ≥ 0.1.18** — depends on the consolidated
  runtime release that includes:
  - `getModels` → `properties.reasoningEfforts` for thinking-capable models
  - extras ancestor walk so nested/readonly AUI clients resolve
    `useTrueFoundryRespondToToolApproval` (sub-agent Allow/Deny)
  - parallel enabled-models + provider-metadata CP fetches
  - `ModelSelectorEntry.name` / `id` = `model_fqn` (`account/model-id`)
  - gateway mount sanitization (`normalizeMcpMount` / `normalizeSkillMount`,
    registry `enableTools` default `["@all"]`)

### Fixed

- **Sub-agent Allow/Deny** — nested tool approvals inside `create_sub_agent` now
  call `useTrueFoundryRespondToToolApproval` with the _nested_ tool's approval
  id. The old bridge keyed off the outer sub-agent part (usually with no
  approval), so clicks silently no-op'd. Requires `@truefoundry/assistant-ui-runtime`
  ≥ 0.1.19 so extras resolve through the readonly nested AUI client.
- **Sandbox provider contract** — drop `snapshotName` from `SandboxProviderConfig`
  and wrap `listSandboxProviders` as `{ data, snapshotSyncStatus }` (Harness
  `status` / `status_reason`). Re-exports `SandboxProviderListEntry` /
  `SandboxSnapshotSyncStatus`.

### Added

- **Draft composer preferences** — plain-draft model, skills, MCP connectors, and
  config choices are remembered (in-memory + `localStorage`) and seed the next
  New Chat after reload. Stale catalog entries are pruned once catalogs load.
  Edit-flow (`agentId` set) and immutable library agents are unchanged.
- **Optional `layout`** — `<TrueForgeUI />` `layout` prop defaults to `"sidebar"`.
- **`type: "trueforge"` built-in server** — `<TrueForgeUI server={{ type: 'trueforge', baseUrl?, token?, fetch? }} />`
  resolves a full Harness `AgentUIServer` via
  `@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter`
  (`createTrueForgeAgentUIServer`), including chat, builder, and default settings
  catalogs. Depends on `@truefoundry/trueforge-sdk` (workspace:* in-monorepo; external in the bundle).
- **Light/dark brand logo** — `theme.brand.logo` accepts a `BrandLogoConfig`
  (`{ src?, light?, dark?, href? }`). The source is picked from the resolved theme
  mode, falling back to the other mode and then `src`, so a single configured mode
  covers both and `{ light }` alone never renders a missing image. `href` wraps the
  logo in a same-tab link. A bare string (`logo: '/logo.svg'`) is shorthand for a
  mode-agnostic source. A config with no usable source falls back to the default
  mark rather than an empty `<img>`.
- **`BrandLogo` slot** — now in the slot table and resolved through `useSlot` by
  every layout, so `overrides={{ BrandLogo: MyMark }}` reaches the sidebar header,
  widget FAB, and welcome screen.
- **`useBrandName()`** — the configured brand name or the default, so layouts no
  longer inline the fallback string.

### Changed

- **Theme preset rename** — default preset id `truefoundry` → `trueforge`
  (`ThemePreset`, `PRESETS`, `data-preset`, docs).
- **Styles auto-inject** — `ThemeProvider` injects the SDK stylesheet at runtime.
  Hosts no longer need `@import '@truefoundry/trueforge-ui/styles.css'` (export
  kept for SSR). Semantic tokens and dark mode are scoped to `.aui-theme-root`
  (no `html.dark` / `:root` retheme of the host page).
- **Dependency** — `@truefoundry/assistant-ui-runtime` pinned to `0.1.13`.
  `ModelSelectorEntry` now requires `id`, nested `provider: ProviderEntry`, and
  `properties: ModelProperties` (replacing flat `provider` / `providerLogo` /
  `reasoningEfforts`). Re-exports `ProviderEntry` and `ModelProperties`.

### Fixed

- **History row mutability** — prefer `custom.isMutable` from the session (runtime
  stamp) over inferring from `agentName`. Orphaned named refs (deleted agent, no
  `agentName`) open as immutable. `openHistorySession` allows `isMutable: false`
  without an agent name.
- **Edit-bound draft history switch** — do not reuse the mutable shell via
  `switchToThread` when the shell still carries an Edit `agentName`/`agentId`
  and the row is a different session. Remount through `openHistorySession` so
  Update Agent chrome cannot overwrite the wrong library agent.

### Breaking

- **Server-port types owned by `@truefoundry/assistant-ui-runtime`** — this package no
  longer defines `AgentChatServer` / `AgentBuilderServer` / catalog DTOs locally.
  Host-facing types are re-exported from `@truefoundry/assistant-ui-runtime/server`
  via `src/server/types.ts`. Prefer importing types from `@truefoundry/trueforge-ui`
  (hosts should not need the runtime package for types). Requires runtime `0.1.13`.
- **Removed public pagination helpers** — `PageResult`, `TokenPagination`,
  `ListSessionsResponse`, `ListTurnsResponse`, `ListSessionEventsResponse`, and
  opaque `SessionEvent` are gone from this package. Chat list APIs use runtime
  `ListResult<T>` (`{ data, nextPageToken? }`).
- **`AgentUIServer` / mounts follow the runtime contract** — composed port matches
  runtime `AgentUIServerPort`; `SkillMount` / `McpServerMount` stay opaque `object`
  (hosts widen via generics). Implement `getCapabilities()` on every builder host.
- **One brand component** — removed the `BrandIcon` export; `BrandLogo` is the only
  product mark and renders the mark alone. Callers that also want the name as text
  pair it with `useBrandName()` (as the sidebar header does), rather than relying on
  a second component that hard-codes one arrangement. Replace `<BrandIcon />` with
  `<BrandLogo />`, and `overrides={{ BrandIcon }}` with `overrides={{ BrandLogo }}`.
- **`brand.name` is required** — `theme.brand` stays optional, but setting it now
  requires `name`, since it labels the logo and a logo with no name has no accessible
  name. `logo` remains optional, so `brand: { name: 'Acme' }` still pairs host text
  with the default mark. `useBrand()` returns `Partial<BrandConfig>`, since `brand`
  may be absent entirely.
- **`theme.brand` is images-only** — removed `brand.icon`; there is one logo source.
  Removed the `ReactNode` and render-function variants of the logo value (and with
  them the `BrandImage` type export), so `brand.logo` is now
  `string | BrandLogoConfig`. Component-valued marks move to the slot table:
  `overrides={{ BrandLogo: MyMark }}`, which is how every other atom is replaced.
  Also removed `alt` — the logo is labelled with `brand.name`, so there is one place
  to set the accessible name.
- **Default brand name is `"TrueForge"`** (was `"TrueFoundry"`), used by
  `BrandLogo`, the sidebar header, and `useBrandName()`.
- **`ShellMode` shape** — replaced `type: 'idle' | 'named' | 'draft'` with
  `status: 'idle' | 'active'` plus `isMutable` on active bindings. Composer /
  Save Agent / welcome chrome key off `isMutable`, not draft|named.
  Hosts that inspected `mode.type` must switch to `mode.status` /
  `mode.isMutable` (see `shellIsMutable`).
- **Renamed `TrueFoundryAssistantUI` → `TrueForgeUI`** (props type
  `TrueFoundryAssistantUIProps` → `TrueForgeUIProps`). Update imports and JSX.
- **`TrueForgeUI` agent props** — replaced top-level `agentName` and
  `defaultAgentSpec` with a single discriminated `agentConfig`. There is no
  compat shim; hosts must update call sites.
- **Icons use Lucide** (`lucide-react`) instead of Font Awesome. Default
  registry keys are unchanged (`paperclip`, `xmark`, …); `theme.icons` values
  are Lucide components, React nodes, render fns, or SVGR SVGs — not
  `IconDefinition`. Drop `@fortawesome/*` if you only used them for this SDK.
- **Removed `tfy-web-components`** dependency and peer. Primitives, icons,
  theme, Markdown, and agent-chat molecules are owned by this SDK.
- `theme` prop is now `ThemeConfig` (object), not `"light" | "dark"`. Mode
  lives at `theme.mode`. Example: `theme={{ mode: "dark", preset: "claude" }}`.
- `AtomSlots` and `SlotOverrides` are derived from `defaultSlots`; consumer
  module augmentation of `AtomSlots` no longer adds override keys.
- `theme.classNames.openui` accepts only `root` and `scope`; arbitrary extra
  keys are no longer supported.
- Complete `SemanticTokens` objects must include `success`,
  `successForeground`, `warning`, and `warningForeground`.
- `Button`, `IconButton`, dialogs, sheets, avatars, and other low-level
  primitives are customized through tokens/CSS rather than slots. Compound
  APIs (`Button.Primary`, `icon=` string props) are gone.
- Import styles with only `@import "@truefoundry/trueforge-ui/styles.css"`
  (no `tfy-web-components/theme.css`).
- `layout` accepts a built-in string **or** a host `React.ComponentType`.
- **`server` prop no longer accepts `{ type: "custom", server }`.** Pass a ready
  `AgentUIServer` directly (`server={agentServer}`). Built-in configs
  (`truefoundry` / `trueforge`) are unchanged and now accept an optional
  `catalog`.

### Added

- **Named agent header title** — when an immutable (named) agent chat is open,
  the thread header shows the agent name on the left (sidebar / drawer / dock /
  widget layouts). Hidden for idle and draft/mutable chats.
- **`AgentLibraryEntry.agentId?` / `agentSpec?`** — optional listing fields.
  Hosts that only return `{ name }` keep working; `agentSpec` enables Edit.
- **Agents Library Edit** — when `isComposerEnabled` and the row has
  `agentSpec`, Edit binds a mutable session seeded from that spec
  (`isMutable: true`). Try Agent remains immutable (`isMutable: false`).
- **`selectLibraryAgent` / `shellIsMutable` / `libraryAgentId`** on shell
  context. `selectAgent` / `openDraft` remain as thin wrappers.
- **Reasoning-effort selector** beside the model picker in the draft composer.
  Shown only when the selected `ModelSelection` declares `reasoningEfforts`;
  the effort is coerced into the spec on model change or explicit pick.
- **Skills catalog** — `getSkillCatalog` with an Available/Selected split;
  registry skills (`catalogId`) return to Available on remove, GitHub imports
  are deleted for good. New types: `RegistrySkill`, `GithubSkill`,
  `DefinedSkill`, `SkillConfigBase`, `SkillCatalogEntry`,
  `CreateSkillRequestBase`, `SelectRegistrySkillRequest`,
  `ImportGithubSkillRequest`, `SkillCatalogServer.getSkillCatalog`.
- **Sandbox catalog** — list/create/update/delete of connected sandboxes from a
  catalog. New types: `SandboxConfig`, `SandboxCatalogEntry`, `SandboxBase`,
  `CreateSandboxRequest`, `UpdateSandboxRequest`, `SandboxCatalogServer`.
  `apiKey` is never stored in the catalog and is optional on update (blank keeps
  the existing key).
- `TrueForgeBuiltInServerConfig` exported for hosts that build the built-in
  config separately.

- **`agentConfig` shell modes** on `TrueForgeUI` /
  `ShellModeProvider`:
  - `SingleAgent` — locked named agent (`name` required)
  - `AgentLibrary` — Agents Library only; idle empty state until pick; no New Chat
  - `AgentComposer` — draft composer only (no library)
  - `AgentLibraryWithComposer` — library + draft (default when omitted)
- **Clear Chat** control in thread headers (sidebar / drawer / dock / widget).
  Resets the current named thread or opens a fresh draft.
- `ClearChatButton`, `SelectAgentEmptyState`, `AgentConfig`,
  `DEFAULT_AGENT_CONFIG` exported from the main barrel.
- Owned `ThemeProvider` with light / dark / system, CSS token injection,
  `theme.brand`, `theme.icons`, `theme.classNames`, `theme.className`.
- Semantic success/warning and assistant-bubble tokens, plus complete Markdown,
  syntax-highlighter, OpenUI, and Monaco class-name hooks.
- Presets: `truefoundry`, `claude`, `chatgpt`, `gemini`.
- `BrandLogo` / `BrandIcon` / `useBrand`; `Icon` / `IconRegistry`.
- Registry-backed robot brand fallback and overridable welcome/OAuth state
  icons. The standalone OAuth callback now inherits the shell theme and slots.
- In-repo Markdown (OpenUI fences + syntax-highlighter), `MonacoEditorCore`,
  `CodeEditor`.
- Public slots for agent-library/save/select controls, draft composer
  selectors, code/content renderers, and file-download UI; nested SDK
  composition now honors those overrides.
- Example app: preset switcher + custom layout demo; `VITE_TFY_AGENT_MODE` to
  try shell modes.

### Migration

#### Component rename

```tsx
// Before
import { TrueFoundryAssistantUI } from '@truefoundry/trueforge-ui';
<TrueFoundryAssistantUI server={server} layout="sidebar" />;

// After
import { TrueForgeUI } from '@truefoundry/trueforge-ui';
<TrueForgeUI server={server} layout="sidebar" />;
```

#### `agentConfig` (host must update)

| Before                                           | After                                                                                         |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `agentName="support-agent"`                      | `agentConfig={{ mode: "SingleAgent", name: "support-agent" }}`                                |
| omit `agentName` (+ optional `defaultAgentSpec`) | omit `agentConfig`, or `agentConfig={{ mode: "AgentLibraryWithComposer", defaultAgentSpec }}` |
| —                                                | `agentConfig={{ mode: "AgentLibrary" }}` — library only, pick agent to start                  |
| —                                                | `agentConfig={{ mode: "AgentComposer", defaultAgentSpec }}` — draft only                      |

```tsx
// Before
<TrueFoundryAssistantUI server={server} layout="sidebar" agentName="support-agent" />
<TrueFoundryAssistantUI
  server={server}
  layout="sidebar"
  defaultAgentSpec={{ model: { name: "openai-main/gpt-4.1" } }}
/>

// After
<TrueForgeUI
  server={server}
  layout="sidebar"
  agentConfig={{ mode: "SingleAgent", name: "support-agent" }}
/>
<TrueForgeUI
  server={server}
  layout="sidebar"
  agentConfig={{
    mode: "AgentLibraryWithComposer",
    defaultAgentSpec: { model: { name: "openai-main/gpt-4.1" } },
  }}
/>
```

`ShellModeProvider` likewise takes `agentConfig` instead of `agentName` /
`defaultAgentSpec`.

#### Other Unreleased migrations

1. Drop `@import "tfy-web-components/theme.css"` and the `tfy-web-components`
   package.
2. Replace `theme="dark"` with `theme={{ mode: "dark" }}`.
3. Update Button/IconButton overrides to the new prop surface.
4. Replace product marks via `theme.brand`; action icons via `theme.icons`
   (Lucide / SVG — not Font Awesome `IconDefinition`).
5. Optionally set `layout={MyLayout}` and style content via
   `theme.classNames` or `.aui-markdown` / `.aui-syntax-highlighter` /
   `.aui-openui` / `.aui-monaco`.
6. Remove consumer `AtomSlots` module augmentations and use the documented
   `SlotOverrides` keys.
7. Replace custom `theme.classNames.openui` keys with `root`, `scope`, or host
   CSS targeting `.aui-openui`.
8. Add success/warning pairs to any complete custom `SemanticTokens` maps.

## [0.1.0]

### Breaking

- Main entry no longer re-exports tfy design-system **values** (`Button`,
  `IconButton`, `IconProvider`, `Modal`, `Dialog`, `Accordion*`, `Skeleton`,
  `LightTooltip`, `registerIcons`, …). Import those from `tfy-web-components`.
  Override **types** `ButtonProps` / `ButtonSize` / `IconButtonProps` remain
  on `@truefoundry/trueforge-ui`.
- Peer dependency ranges aligned with supported versions (`@truefoundry/assistant-ui-runtime` `^0.1.4`, `truefoundry-gateway-sdk` `^0.4.0-rc.1`, `tfy-web-components` `^0.0.31`).
- tfy/MUI peer stack (`@mui/material`, `@emotion/*`, Font Awesome, `@openuidev/*`) moved from `dependencies` to `peerDependencies`; hosts must install them.
- `MessageTimestamp` is presentational and requires `createdAt`.
- `UserMessageActionBar` is presentational (copy/edit/retry props); runtime wiring lives in containers.
- `MessageActionBar` accepts optional `createdAt` and passes it to `MessageTimestamp`.
- Default stylesheet no longer loads Google Fonts from the CDN; override `--font-agent-ui` in host CSS if needed.
- `prepare` script replaced with `prepublishOnly` (install no longer builds automatically).

### Added

- `TrueForgeUI` quick-start component with `layout`: `sidebar` | `drawer` |
  `dock` | `widget` (slots outside the chat provider so toast overrides apply).
- Curated re-exports: `useAui`, `useAuiState`, `AssistantState` from the main
  barrel and `@truefoundry/trueforge-ui/assistant-ui`; `useTheme` from the main
  barrel.
- Optional `onThreadOpen` on `ThreadListContainer` for stack/drawer chrome.
- npm package metadata: `repository`, `homepage`, `bugs`, `keywords`.
- Drawer / widget Escape-to-close; drawer backdrop dismiss; widget `aria-modal`.
- Drawer / widget focus management (`inert` on background, focus dialog, restore).
- `docs/api.md` curated public API reference.
- CI coverage floor + example app build.
- Apache-2.0 `LICENSE`, `NOTICE`, `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`.
- GitHub issue/PR templates and CI workflow.
- `docs/` (architecture, customization, compatibility).
- ESLint + Prettier.
- Unit tests for tool-call parsing helpers and `computeAgentStepsSplit`.

### Changed

- Required peers are only `react` / `react-dom`. `@assistant-ui/core`
  (`^0.2.22`), `@assistant-ui/react` (`^0.14.24`), and
  `tfy-web-components@^0.0.32` moved to `dependencies` (still listed as optional
  peers for hosts that install them directly for customization). Happy path:
  `yarn add @truefoundry/trueforge-ui`. Yarn `resolutions` pin a single
  `@assistant-ui/core` / `store` / `tap` copy to avoid duplicate AuiProvider.
- `tfy-web-components` resolves from npm (`^0.0.32`) instead of a local
  `file:` tarball.
- MUI / Emotion / OpenUI / Monaco / extra Font Awesome packages come from
  `tfy-web-components` (not peers of this SDK).
- Font Awesome packages this SDK imports (`fontawesome-svg-core`,
  `free-solid-svg-icons`) moved to `dependencies`.
- `SlotOverrides` is `Partial<AtomSlots>` only (no `Record<string, unknown>`).
- `TrueForgeUI` lazy-layout `Suspense` fallback is a pulse skeleton
  instead of blank.
- README reordered: quick start (prefer `client`) before advanced sections.

### Removed

- Unused `TokensProvider` / `useTokens` / `defaultTokens` public API (and
  related token types). Theme via CSS variables from `styles.css` instead.
- `examples/vite-chat` sample app.
- Unused `classnames` dependency (provided by `tfy-web-components@^0.0.32`).
- Direct design-system `devDependencies` duplicated from web-components
  (`@mui/material`, `@emotion/*`, `@openuidev/*`, `monaco-editor`,
  `@fortawesome/free-regular-svg-icons`, `@fortawesome/react-fontawesome`).
- Standalone `@truefoundry/trueforge-ui/openui.css` export — OpenUI styles ship
  inside `styles.css`.
- Unused packages: `lodash-es`, `react-markdown`, `remark-gfm`, `class-variance-authority`.
- Broken `pack:dev` script.

### Fixed

- Error toasts stack (up to 5), use compact theme sizing, and include a copy action.
- Atom/container architecture: atoms no longer import `@assistant-ui/*`.
- Error toasts truncate large gateway response bodies.

### Note

- `github-markdown-css` remains a **devDependency** required to compile
  `dist/styles.css` (pulled in via tfy Markdown CSS).

## [0.0.8] - 2026-07-24

### Changed

- Package and dependency updates prior to the 0.1.0 open-source readiness pass.
