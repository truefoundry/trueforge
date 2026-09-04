# @truefoundry/trueforge-ui

[CI](https://github.com/truefoundry/trueforge/actions/workflows/ci.yml)
[npm](https://www.npmjs.com/package/@truefoundry/trueforge-ui)
[License](./LICENSE)

A themeable, composable React SDK for building production-ready AI agent chat applications.  
Build your own agent chat platform with a flexible UI layer that works with **TrueFoundry** (Control Plane + Gateway), **TrueForge** (harness), or any custom backend. The SDK is fully open source, giving you complete control over your architecture, components, and integrations.  
Powered by [assistant-ui](https://www.assistant-ui.com/), it follows the familiar **shadcn/ui** and **Tailwind CSS variable** theming conventions, making it easy to customize every aspect of the experience.

**Features**

- **Fully themeable** — Use built-in themes inspired by **TrueFoundry**, **ChatGPT**, **Claude**, and **Gemini**, or create your own brand identity.
- **Composable by design** — Swap layouts, components, and interaction patterns to fit your product.
- **Backend agnostic** — Connect to **TrueFoundry**, **TrueForge**, or any custom API via `TrueForgeServerConfig`.
- **Open source** — Extend, customize, and contribute without vendor lock-in.
- **Built on assistant-ui** — Leverage a modern React foundation with seamless shadcn/ui and Tailwind CSS integration.
- **Production ready** — Focus on your agents while the SDK handles the chat experience.

Bring your own **brand, colors, layout, components, and server**—the Agent SDK wires up the rest.

---

## Table of contents

- [Installation](#installation)
- [Getting started](#getting-started)
- [`<TrueForgeUI />` props](#trueforgeui--props)
- [Theming](#theming)
- [Content classNames](#content-classnames)
- [Brand / logo](#brand--logo)
- [Agent modes](#agent-modes)
- [Layouts](#layouts)
- [Custom layouts](#custom-layouts)
- [Overriding components](#overriding-components)
- [Server](#server)
- [Exports](#exports)
- [Docs](#docs)
- [License](#license)

---

## Installation

```bash
npm install @truefoundry/trueforge-ui
# or
pnpm add @truefoundry/trueforge-ui
# or
yarn add @truefoundry/trueforge-ui
```

`react` / `react-dom` are required peers. The **host app must have
[Tailwind CSS](https://tailwindcss.com/) set up** (v4 recommended) so preflight
and your app chrome work alongside the SDK. In the host stylesheet:

```css
@import 'tailwindcss';
```

SDK styles (tokens, utilities, OpenUI) load automatically when `TrueForgeUI` /
`ThemeProvider` mounts — you do **not** need to import the SDK stylesheet for
client-only apps.

Optional (SSR / explicit load order):

```css
@import 'tailwindcss';
@import '@truefoundry/trueforge-ui/styles.css';
```

See [docs/compatibility.md](./docs/compatibility.md) for version ranges.

---

## Getting started

**TrueFoundry** (`type: "truefoundry"`) — Control Plane + Gateway

Zero-config path: the SDK builds the agent UI server from your API key and
control plane URL (optional explicit gateway URL).

```tsx
import { TrueForgeUI } from '@truefoundry/trueforge-ui';

export default function App() {
  return (
    <div style={{ height: '100dvh' }}>
      <TrueForgeUI
        server={{
          type: 'truefoundry',
          apiKey: process.env.TFY_API_KEY!,
          controlPlaneURL: process.env.TFY_CONTROL_PLANE_URL!,
          // gatewayPlaneURL: process.env.TFY_GATEWAY_URL, // optional
        }}
        layout="sidebar"
      />
    </div>
  );
}
```

**TrueForge** (`type: "trueforge"`) — Harness

Zero-config path for the TrueForge / Harness API. The SDK dynamically loads
`@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter`, builds the
HTTP client, and composes chat + builder + default settings catalogs into an
`AgentUIServer`.

Install the SDK peer used by the adapter (workspace package in this monorepo):

```bash
pnpm add @truefoundry/trueforge-sdk
```

**Bearer token (embeds / remote API):**

```tsx
import { TrueForgeUI } from '@truefoundry/trueforge-ui';

export default function App() {
  return (
    <div style={{ height: '100dvh' }}>
      <TrueForgeUI
        server={{
          type: 'trueforge',
          baseUrl: process.env.TRUEFORGE_BASE_URL, // optional; default '/'
          token: process.env.TRUEFORGE_TOKEN!,
        }}
        layout="sidebar"
      />
    </div>
  );
}
```

**Cookie / same-origin hosts** — omit `token` and inject `fetch` (e.g. an
auth-aware wrapper that follows OIDC cookies):

```tsx
<TrueForgeUI
  server={{
    type: 'trueforge',
    baseUrl: '/',
    fetch: authAwareFetch,
  }}
  layout="sidebar"
  agentConfig={{
    mode: 'AgentLibraryWithComposer',
    defaultAgentSpec: { model: { name: '…' } }, // often seeded at boot from listModels
  }}
/>
```

Optional: pass `catalog` to override the built-in settings catalogs, or import
`createTrueForgeAgentUIServer` from
`@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter` when you need
the factory outside `<TrueForgeUI />`.

**Custom** — bring your own `AgentUIServer`

Use this when you compose chat + builder yourself (e.g. chat-only gateway
adapter + stub catalog, or a full host BFF). Pass the server object directly.

```tsx
import { TrueForgeUI, createTrueFoundryServer } from '@truefoundry/trueforge-ui';
import { createTrueFoundryChatServer } from '@truefoundry/assistant-ui-runtime/plugins/truefoundry-agent-server-adapter';

const chatServer = createTrueFoundryChatServer({
  apiKey: process.env.TFY_API_KEY!,
  baseUrl: process.env.TFY_GATEWAY_URL!,
});

const server = createTrueFoundryServer({
  chatServer,
  getModels: async () => [],
  getSkills: async () => [],
  getMcp: async () => [],
  searchAgents: async () => [],
  saveAgent: async () => ({}),
});

export default function App() {
  return (
    <div style={{ height: '100dvh' }}>
      <TrueForgeUI server={server} layout="sidebar" />
    </div>
  );
}
```

## `<TrueForgeUI />` props

`<TrueForgeUI />` is the single entry point. Every capability is driven by a prop.

```tsx
<TrueForgeUI
  server={{
    type: 'truefoundry',
    apiKey: process.env.TFY_API_KEY!,
    controlPlaneURL: process.env.TFY_CONTROL_PLANE_URL!,
  }} // or agentServer / { type: "trueforge", token?, baseUrl?, fetch? }
  layout="sidebar" // 'sidebar' | 'drawer' | 'dock' | 'widget' | CustomLayout
  agentConfig={{
    mode: 'AgentLibraryWithComposer', // default when omitted
    defaultAgentSpec: { model: { name: 'openai-main/gpt-4.1' } },
  }}
  theme={{
    preset: 'claude',
    brand: { mode: 'icon-title', name: 'Acme', icon: '/icon.svg' },
  }}
  overrides={{/* slot overrides */}}
  className="h-full"
/>
```

| Prop               | Type                       | Required | Description                                                                                                        |
| ------------------ | -------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ |
| `server`           | `TrueForgeServerConfig`    | ✅       | Built-in config (`truefoundry` / `trueforge`) **or** a ready `AgentUIServer`.                                      |
| `layout`           | `LayoutProp`               | ✅       | Built-in layout string **or** a custom React component.                                                            |
| `agentConfig`      | `AgentConfig`              | —        | Shell mode: SingleAgent / AgentLibrary / AgentComposer / AgentLibraryWithComposer. Defaults to library + composer. |
| `theme`            | `ThemeConfig`              | —        | Preset, mode, tokens, brand, icons, **content `classNames`** (see [Theming](#theming)).                            |
| `overrides`        | `SlotOverrides`            | —        | Map of slot overrides (see [Overriding components](#overriding-components)).                                       |
| `className`        | `string`                   | —        | Applied to the layout root.                                                                                        |
| `initialSessionId` | `string`                   | —        | Resume a specific session.                                                                                         |
| `onError`          | `(error: unknown) => void` | —        | Host error hook (runtime + server init).                                                                           |

Later sections use `server` as a `TrueForgeServerConfig` (usually `type: "truefoundry"`). For a host-built port, pass the `AgentUIServer` directly.

---

## Theming

Pass a preset and/or tokens and the whole UI adapts. Values map onto product CSS variables (`--primary-bg`, `--text-primary`, `--card-bg`, `--primary-button-bg`, `--failure-bg`, `--radius`, …), so no component needs palette-specific code.

```tsx
const server = {
  type: 'truefoundry' as const,
  apiKey: process.env.TFY_API_KEY!,
  controlPlaneURL: process.env.TFY_CONTROL_PLANE_URL!,
};

<TrueForgeUI
  server={server}
  layout="sidebar"
  theme={{
    preset: 'claude', // 'trueforge' | 'claude' | 'chatgpt' | 'gemini'
    mode: 'dark', // omit for uncontrolled (useTheme().setTheme works)
    tokens: {
      primaryBg: 'oklch(0.14 0.02 260)',
      textPrimary: 'oklch(0.97 0 0)',
      secondaryBg: 'oklch(0.22 0.02 260)',
      primaryButtonBg: 'oklch(0.55 0.2 275)',
      primaryButtonHover: 'oklch(0.5 0.2 275)',
      primaryButtonText: 'oklch(0.98 0 0)',
      ghostButtonHover: 'oklch(0.8 0.12 200)',
      radius: '0.5rem',
    },
  }}
/>;
```

You can also override tokens from host CSS on `.aui-theme-root` (inline `theme.tokens` still win over `:root`):

```css
.aui-theme-root {
  --font-agent-ui: 'Your Font', ui-sans-serif, system-ui, sans-serif;
  --primary-button-bg: oklch(0.55 0.2 275);
}
```

> _Screenshot: the same layout rebranded with a custom palette._

See [docs/theming.md](./docs/theming.md) for presets, controlled vs uncontrolled mode, and deeper theming notes.

---

## Content classNames

Style content renderers (markdown, code fences, OpenUI, Monaco) without swapping
slots. Pass `theme.classNames` on `<TrueForgeUI />` — values merge onto the
defaults via `cn()`:

```tsx
<TrueForgeUI
  server={server}
  layout="sidebar"
  theme={{
    classNames: {
      markdown: 'prose prose-neutral dark:prose-invert max-w-none',
      inlineCode: 'font-semibold',
      syntaxHighlighter: {
        root: 'my-code-block rounded-lg',
        pre: 'bg-zinc-950 p-4',
        code: 'text-sm font-mono',
        lineNumber: 'opacity-60',
      },
      openui: { root: 'my-openui-host', scope: 'p-2' },
      monaco: { root: 'my-monaco h-64', editor: 'rounded-lg', monacoTheme: 'vs-dark' },
    },
  }}
/>
```

| `theme.classNames` key | Component / surface                         | Fields                                            |
| ---------------------- | ------------------------------------------- | ------------------------------------------------- |
| `markdown`             | `Markdown` (message prose root)             | `string`                                          |
| `inlineCode`           | `Markdown` inline `` `code` ``              | `string`                                          |
| `syntaxHighlighter`    | `SyntaxHighlighter` (non-OpenUI fences)     | `root`, `pre`, `code`, `lineNumber`               |
| `openui`               | `OpenUiFenceBlock`                          | `root`, `scope`                                   |
| `monaco`               | `MonacoEditorCore` (code artifacts / diffs) | `root`, `editor`, `monacoTheme` (Monaco theme id) |

Custom layouts and host atoms under the provider can read the same map with
`useOptionalContentClassNames()` / `useContentClassNames()` (exported from the
package). Host CSS on `.aui-markdown` / `.aui-syntax-highlighter` / `.aui-openui`
/ `.aui-monaco` still works as an alternative.

---

## Brand / logo

Set `brand.mode`, then pass the fields that mode requires. `name` always labels the
mark (`alt` / `aria-label`).

| Look         | `mode`         | Required                   | Expanded chrome           | Collapsed / compact |
| ------------ | -------------- | -------------------------- | ------------------------- | ------------------- |
| Default      | omit `brand`   | —                          | TrueForge wordmark        | TrueForge square    |
| Icon + title | `'icon-title'` | `name` (+ optional `icon`) | square + title text       | square              |
| Icon only    | `'icon-only'`  | `name`, `icon`             | square (no title text)    | square              |
| Wide logo    | `'logo'`       | `name`, `icon`, `logo`     | wide logo (no title text) | square              |

```tsx
<TrueForgeUI
  server={server}
  layout="sidebar"
  theme={{
    brand: {
      mode: 'icon-title',
      name: 'Acme',
      icon: '/brand/icon.svg',
    },
  }}
/>
```

Icon-only chrome (`name` kept for alt):

```tsx
theme={{
  brand: {
    mode: 'icon-only',
    name: 'Acme',
    icon: '/brand/icon.svg',
  },
}}
```

Wide logo for expanded chrome. A square `icon` is required because collapsed chrome,
the welcome screen, and the widget button continue to use the square asset:

```tsx
<TrueForgeUI
  server={server}
  layout="sidebar"
  theme={{
    brand: {
      mode: 'logo',
      name: 'Acme',
      icon: '/brand/icon.svg',
      logo: '/brand/wordmark.svg',
      href: '/',
    },
  }}
/>
```

Both `icon` and `logo` accept `{ src, light, dark }`. The SDK picks the source matching the
resolved theme mode; setting only one light/dark source uses it for both. `href` wraps
configured images in a same-tab link.

**Component marks** — `theme.brand` takes image URLs only. To render an inline SVG or a custom
component, override the `BrandLogo` slot, the same way you replace any other atom:

```tsx
<TrueForgeUI server={server} layout="sidebar" overrides={{ BrandLogo: MyMark }} />
```

**Custom layouts** — import `BrandLogo` and use `variant="icon"` for compact surfaces or
`variant="logo"` for expanded chrome. Prefer `resolveBrandChrome(useBrand())` so expanded
vs collapsed choices match the base layouts. Pair with `useBrandName()` when chrome should
show the title text (see [Custom layouts](#custom-layouts)).

> _Screenshot: external brand mark rendered in the base layout header._

---

## Agent modes

`agentConfig` controls library chrome, draft composer, and how New Chat / Clear Chat behave.

| Mode                                   | Layout chrome                   | Agent selection / New Chat                                |
| -------------------------------------- | ------------------------------- | --------------------------------------------------------- |
| `AgentLibraryWithComposer` _(default)_ | Agents + draft builder          | New Chat opens draft; library picks a named agent         |
| `SingleAgent`                          | Named-only, plain composer      | Locked to `name`; New Chat / Clear Chat = new thread      |
| `AgentLibrary`                         | Agents only (no draft)          | Empty until pick; no New Chat; Clear Chat after selection |
| `AgentComposer`                        | Draft builder only (no library) | Always draft; New Chat / Clear Chat = fresh draft         |

In library modes, picking an agent from Agents switches to a named chat for that agent **and remounts the runtime** so the new agent starts from a clean conversation. Draft chats can be promoted via **Save agent** (`server.saveAgent` on the resolved `AgentUIServer`). **Clear Chat** (thread header) resets the current named or draft session.

Mutable composers expose **Agent Config** for live model parameters, instructions, runtime behavior, per-connector MCP tools, and skills. The compact Tools picker contains only Connectors and Skills. The Save Agent dialog keeps a local editable copy of the same configuration and shares the same selector dialogs; cancelling it leaves the active draft unchanged. Model context and output limits render when the server supplies that optional catalog metadata.

```tsx
{
  /* Library + draft (default) */
}
<TrueForgeUI server={server} layout="sidebar" />;

{
  /* Named-only lock */
}
<TrueForgeUI server={server} layout="sidebar" agentConfig={{ mode: 'SingleAgent', name: 'support-agent' }} />;

{
  /* Library only — select an agent to start */
}
<TrueForgeUI server={server} layout="sidebar" agentConfig={{ mode: 'AgentLibrary' }} />;

{
  /* Composer only */
}
<TrueForgeUI
  server={server}
  layout="sidebar"
  agentConfig={{
    mode: 'AgentComposer',
    defaultAgentSpec: { model: { name: 'openai-main/gpt-4.1' } },
  }}
/>;
```

> _Screenshot: Agents open; selecting an agent resets the thread._

---

## Layouts

Built-in `layout` values:

| Value     | Description                                              |
| --------- | -------------------------------------------------------- |
| `sidebar` | Left session list + main thread (ChatGPT / Claude style) |
| `drawer`  | Full-bleed thread; sessions open in a slide-over         |
| `dock`    | Fixed-width right panel; list XOR thread stack           |
| `widget`  | Same stack as `dock`, opened from a bottom-right FAB     |

---

## Custom layouts

For full control, pass a React component as `layout`. The SDK still wires server, shell mode, slots, and runtime behind it.

```tsx
import { Thread, ThreadListContainer, BrandLogo, useTheme } from '@truefoundry/trueforge-ui';

function Layout({ className }: { className?: string }) {
  const { mode, setTheme } = useTheme();

  return (
    <div className={className} style={{ display: 'flex', height: '100%' }}>
      <aside style={{ width: 256 }}>
        <BrandLogo variant="logo" className="h-6 w-auto max-w-40" />
        <ThreadListContainer />
      </aside>
      <main style={{ flex: 1, minWidth: 0 }}>
        <button type="button" onClick={() => setTheme(mode === 'dark' ? 'light' : 'dark')}>
          Theme
        </button>
        <Thread />
      </main>
    </div>
  );
}

<TrueForgeUI server={server} layout={Layout} />;
```

For deeper composition without `TrueForgeUI`, nest `SlotsProvider` outside `TrueFoundryChatProvider` — see [docs/customization.md](./docs/customization.md).

> _Screenshot: a custom layout assembled from_ `BrandLogo`_,_ `ThreadListContainer`_, and_ `Thread`_._

---

## Overriding components

Every curated feature atom is overridable. Provide an `overrides` map to swap any single component while inheriting the rest.

```tsx
import { TrueForgeUI, type AssistantMessageBubbleProps } from '@truefoundry/trueforge-ui';

function MyBubble({ children, error, actionBar, className }: AssistantMessageBubbleProps) {
  return (
    <div className={`flex flex-col gap-2 border-l-2 border-primary-button-bg pl-3.5 ${className ?? ''}`}>
      {error ? <div className="rounded-lg bg-failure-bg/10 px-2.5 py-2 text-sm text-failure-bg">{error}</div> : null}
      <div>{children}</div>
      {actionBar}
    </div>
  );
}

<TrueForgeUI
  server={server}
  layout="sidebar"
  overrides={{
    AssistantMessageBubble: MyBubble,
    // WelcomeScreen, ComposerShell, ToolCallCard, … all overridable
  }}
/>;
```

Overridable slots include composer pieces (`ComposerShell`, `ComposerLeftSection`, `ComposerRightSection`, `ComposerSendButton`), messages (`AssistantMessageBubble`, `UserMessageBubble`, `UserMessageEdit`), `Markdown`, `WelcomeScreen`, thread-list atoms, agent metrics (`AgentMetrics`, `AgentMetricsView`, `AgentMetricsTimeRangeFilter`, `AgentMetricCard`, `AgentMetricChart`), and tool/prompt cards (`ToolCallCard`, `ToolApprovalBar`, `ToolGroupCard`, `SubAgentCard`, `SandboxToolCallCard`, `AgentStepsCard`, `ReasoningCard`, `AskUserPrompt`, `McpAuthPrompt`, and more).

See [docs/customization.md](./docs/customization.md) for the full slot list.

---

## Server

`<TrueForgeUI />` takes a **`TrueForgeServerConfig`**: built-in backends init
inside the component, or pass a ready `AgentUIServer` directly.

```ts
type TrueForgeServerConfig =
  | {
      type: 'truefoundry';
      apiKey: string;
      controlPlaneURL: string;
      gatewayPlaneURL?: string;
    }
  | {
      type: 'trueforge';
      baseUrl?: string;
      token?: string;
      fetch?: typeof fetch;
      catalog?: CatalogServer;
    }
  | AgentUIServer;

type AgentUIServer = AgentChatServer &
  AgentBuilderServer & {
    catalog?: CatalogServer;
    sessions?: AgentSessionsServer;
    metrics?: AgentMetricsServer;
  };
```

| Port                 | Responsibility                                                      |
| -------------------- | ------------------------------------------------------------------- |
| `AgentChatServer`    | Sessions, turns, streaming, draft `AgentSpec` sync                  |
| `AgentBuilderServer` | `getModels` / `getSkills` / `getMcp` / `searchAgents` / `saveAgent` |
| `AgentMetricsServer` | Agent meter aggregates, chart definitions, and chart data           |

**Zero-config TrueFoundry** — see [Getting started](#getting-started). The SDK calls `createTrueFoundryAgentUIServer` for you.

**Zero-config TrueForge (Harness)** — see [Getting started](#getting-started).
`type: "trueforge"` resolves via
`@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter`
(`createTrueForgeAgentUIServer`: chat + builder + default catalogs). Auth is
host-owned: pass `token` and/or `fetch`.

**Compose your own `AgentUIServer` (custom):**

```tsx
import { TrueForgeUI, createTrueFoundryServer } from '@truefoundry/trueforge-ui';
import { createTrueFoundryChatServer } from '@truefoundry/assistant-ui-runtime/plugins/truefoundry-agent-server-adapter';

const chatServer = createTrueFoundryChatServer({ apiKey, baseUrl });
const agentServer = createTrueFoundryServer({
  chatServer,
  getModels,
  getSkills,
  getMcp,
  searchAgents,
  saveAgent,
});

<TrueForgeUI server={agentServer} layout="sidebar" />;
```

**Implement `AgentUIServer` yourself:**

```tsx
import { TrueForgeUI, type AgentUIServer } from '@truefoundry/trueforge-ui';

const agentServer: AgentUIServer = {
  // AgentChatServer methods…
  createSession,
  listSessions,
  getSession,
  updateSession,
  createTurn,
  // …
  // AgentBuilderServer methods…
  getModels: async () => [],
  getSkills: async () => [],
  getMcp: async () => [],
  searchAgents: async () => [],
  saveAgent: async ({ agentName, agentSpec }) => ({ ok: true }),
};

<TrueForgeUI server={agentServer} layout="sidebar" />;
```

See [docs/server.md](./docs/server.md) for the full method list and BYO guidance.

---

## Exports

| Export                                                             | Kind       | Purpose                                                      |
| ------------------------------------------------------------------ | ---------- | ------------------------------------------------------------ |
| `TrueForgeUI`                                                      | Component  | Root component — accepts all props above                     |
| `TrueForgeServerConfig`                                            | Type       | `server` prop: `truefoundry` / `trueforge` / `AgentUIServer` |
| `createTrueFoundryServer`                                          | Function   | Compose chat + builder into `AgentUIServer`                  |
| `Thread`, `ThreadListContainer`, `BrandLogo`                       | Components | Layout primitives for custom layouts                         |
| `resolveBrandChrome`, `useBrandName`, `useBrand`                   | Helpers    | Brand chrome look + name for custom layouts                  |
| Composer / message / tool atoms                                    | Components | Overridable, themeable building blocks                       |
| `SlotsProvider`, `useSlot`, `useTheme`                             | API        | Overrides + theme mode                                       |
| `AgentUIServer`, `AgentChatServer`, `AgentBuilderServer`           | Types      | Resolved server contract                                     |
| `ThemeConfig`, `LayoutProp`, `SlotOverrides`, `AgentSpec`, …       | Types      | Configuration contracts                                      |
| `@truefoundry/trueforge-ui/styles.css`                             | CSS        | Optional; auto-injected by `ThemeProvider`                   |
| `@truefoundry/trueforge-ui/assistant-ui`                           | Entry      | Shared `useAui` / `useAuiState` (single instance)            |
| `@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter` | Entry      | `createTrueForgeAgentUIServer` + Harness catalogs / chat     |

Curated public API: [docs/api.md](./docs/api.md).

---

## Docs

| Doc                                              | Topic                         |
| ------------------------------------------------ | ----------------------------- |
| [docs/api.md](./docs/api.md)                     | Curated public API            |
| [docs/architecture.md](./docs/architecture.md)   | Atoms, containers, slots      |
| [docs/customization.md](./docs/customization.md) | Theme, slots, custom layout   |
| [docs/compatibility.md](./docs/compatibility.md) | Peer matrix                   |
| [docs/server.md](./docs/server.md)               | Server port + BYO             |
| [docs/theming.md](./docs/theming.md)             | Themes, brand, icons, presets |
| [CHANGELOG.md](./CHANGELOG.md)                   | Migration notes               |

### Troubleshooting: "requires an AuiProvider"

Usually duplicate `@assistant-ui/core` / `@assistant-ui/store` instances. Diagnose with `pnpm why`, align `react` across the workspace, and import chrome hooks from `@truefoundry/trueforge-ui` (or `/assistant-ui`) so you share the SDK’s copy.

### Development

From the monorepo root:

```bash
pnpm install
pnpm --filter @truefoundry/trueforge-ui typecheck
pnpm --filter @truefoundry/trueforge-ui test
pnpm --filter @truefoundry/trueforge-ui build
```

Publishing: see [RELEASING.md](../../RELEASING.md#releasing-truefoundrytrueforge-ui).

---

## License

MIT. See [LICENSE](./LICENSE) and [NOTICE](./NOTICE).

Security: [SECURITY.md](./SECURITY.md) · Conduct: [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) · Changes: [CHANGELOG.md](./CHANGELOG.md)
