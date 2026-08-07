# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

- **`ShellMode` shape** — replaced `type: 'idle' | 'named' | 'draft'` with
  `status: 'idle' | 'active'` plus `isMutable` on active bindings. Composer /
  Save Agent / welcome chrome key off `isMutable`, not draft|named.
  Hosts that inspected `mode.type` must switch to `mode.status` /
  `mode.isMutable` (see `shellIsMutable`).
- **Renamed `TrueFoundryAssistantUI` → `TrueforgeUI`** (props type
  `TrueFoundryAssistantUIProps` → `TrueforgeUIProps`). Update imports and JSX.
- **`TrueforgeUI` agent props** — replaced top-level `agentName` and
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
- Slot `Button` / `IconButton` use shadcn-aligned props (`variant`, `size`,
  children). Compound APIs (`Button.Primary`, `icon=` string props) are gone.
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
- `TrueforgeBuiltInServerConfig` exported for hosts that build the built-in
  config separately.

- **`agentConfig` shell modes** on `TrueforgeUI` /
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
- Presets: `truefoundry`, `claude`, `chatgpt`, `gemini`.
- `BrandLogo` / `BrandIcon` / `useBrand`; `Icon` / `IconRegistry`.
- In-repo Markdown (OpenUI fences + syntax-highlighter), `MonacoEditorCore`,
  `CodeEditor`.
- Example app: preset switcher + custom layout demo; `VITE_TFY_AGENT_MODE` to
  try shell modes.

### Migration

#### Component rename

```tsx
// Before
import { TrueFoundryAssistantUI } from '@truefoundry/trueforge-ui';
<TrueFoundryAssistantUI server={server} layout="sidebar" />;

// After
import { TrueforgeUI } from '@truefoundry/trueforge-ui';
<TrueforgeUI server={server} layout="sidebar" />;
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
<TrueforgeUI
  server={server}
  layout="sidebar"
  agentConfig={{ mode: "SingleAgent", name: "support-agent" }}
/>
<TrueforgeUI
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

- `TrueforgeUI` quick-start component with `layout`: `sidebar` | `drawer` |
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
- `TrueforgeUI` lazy-layout `Suspense` fallback is a pulse skeleton
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
