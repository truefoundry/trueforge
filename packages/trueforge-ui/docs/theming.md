# Plan: Remove `tfy-web-components`, own shadcn primitives + themes

Hard-cut `tfy-web-components`. Own primitives (shadcn-style, in-repo),
Markdown/OpenUI/syntax-highlighter/Monaco, Lucide icons (swappable map +
SVG transform), and a **theme object** with presets
(`trueforge` | `claude` | `chatgpt` | `gemini`) plus full token / className /
icon / **brand** / **content classNames** customization. Shell also accepts a
**custom layout** React component built from `Thread`, thread list, etc.

## Principle: everything customizable

Hosts must be able to restyle, rebrand, and rearrange chrome without forking
the SDK. Layers (each independently overridable):

| Layer              | What it customizes                           | How                                           |
| ------------------ | -------------------------------------------- | --------------------------------------------- |
| Preset             | Baseline look                                | `theme.preset`                                |
| Tokens             | Colors, radius, fonts, bubble colors         | `theme.tokens` + CSS vars                     |
| Brand              | Square icon, wide logo, and display name     | `theme.brand` (marks via slots)               |
| Icons              | Action / UI icon set                         | `theme.icons` (Lucide + SVG transforms)       |
| Content classNames | Markdown, syntax-highlighter, OpenUI, Monaco | `theme.classNames`                            |
| Root class         | Arbitrary host utilities                     | `theme.className`                             |
| Host CSS           | Any token / layout tweak                     | documented `:root` / `.aui-root` overrides    |
| Slots              | Replace any React piece                      | `overrides` / `SlotsProvider`                 |
| Layout             | Entire chrome arrangement                    | `layout` string **or** custom React component |

No visual or chrome element should be hard-wired to TrueFoundry branding.
Defaults may ship TFY look; every surface must accept a host override.

## Constraint

All work in **`@truefoundry/trueforge-ui`**. No runtime package changes for this
track (orthogonal to [`docs/server.md`](./server.md)).

## Locked decisions

| Decision        | Choice                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------- |
| Cutover         | Hard cut — remove dep + peer                                                             |
| Primitives      | shadcn components **copied into** this repo                                              |
| Coverage        | Everything currently pulled from tfy                                                     |
| Slot API        | **Breaking** — drop `Button.Primary` / icon-string contracts; new shadcn-aligned props   |
| Icons           | Lucide defaults; host can replace map + supply SVG transforms                            |
| Brand           | Icon/logo URLs (per-mode) via `theme.brand`; component marks via the `BrandLogo` slot    |
| Theme API       | Object (not string-only); every look aspect customizable                                 |
| Presets         | Inspired-by packs: `trueforge` (default), `claude`, `chatgpt`, `gemini`                  |
| Custom styles   | CSS tokens + `className`; host may also import CSS (documented). No “load CSS file” prop |
| Light / dark    | Controlled `mode` on the theme object **or** omit → uncontrolled `useTheme().setTheme`   |
| React overrides | Structural pieces via **`overrides` / slots**; full chrome via **`layout` component**    |
| Markdown        | In-repo; OpenUI kept; code fences via syntax-highlighter                                 |
| Monaco          | In-repo (code artifacts / rich code surfaces); classNames overridable                    |
| Content styling | `theme.classNames` for markdown, highlighter, OpenUI, Monaco                             |
| Layout          | Built-in presets **or** host `React` layout using exported building blocks               |
| Release         | Breaking **0.x** (slot API + styles + drop tfy)                                          |

## Inventory → replacements

### Primitives (slot defaults today)

| Current (tfy)      | Target (in-repo shadcn-style)                                              |
| ------------------ | -------------------------------------------------------------------------- |
| `Button`           | `Button` (variants: default, secondary, ghost, destructive, outline, size) |
| `IconButton`       | `Button` size=`icon` **or** thin `IconButton` wrapper                      |
| `Modal` / `Dialog` | `Dialog` (+ sheet if drawer needs it)                                      |
| `Accordion*`       | `Accordion`                                                                |
| `LightTooltip`     | `Tooltip`                                                                  |
| `Skeleton`         | `Skeleton`                                                                 |
| `Avatar*`          | `Avatar`                                                                   |
| `Spinner`          | small `Spinner` / loader (FA or inline SVG)                                |
| `DropdownMenu`     | `DropdownMenu`                                                             |

### Feature atoms that wrap tfy molecules

Rebuild in-repo (keep existing atom **names** / slots where possible, change
props):

- Bubbles: `AssistantMessageBubble`, `UserMessageBubble`, `UserMessageEdit`
- Tools: `ToolCallCard`, `ToolCallContentBlock`, `ToolApprovalBar`,
  `ToolGroupCard`, `SubAgentCard`, `SandboxToolCallCard`, `AgentStepsCard`,
  `ReasoningCard`
- Prompts: `AskUserPrompt`, `McpAuthPrompt`, `ResumeUnavailable`
- `Markdown` (OpenUI + highlighter)
- Layout helpers using `IconProvider` → local icon resolver

### Theme / icons / brand infra

| Remove                           | Replace with                                                            |
| -------------------------------- | ----------------------------------------------------------------------- |
| `tfy-web-components/theme.css`   | Own palette + semantic tokens in `styles.css`                           |
| tfy `ThemeProvider` / `useTheme` | SDK `ThemeProvider` owned here                                          |
| `IconProvider` + `registerIcons` | `IconRegistry` + `theme.icons` / `setIcons`                             |
| Hard-coded TFY marks             | `theme.brand.icon` / `logo` consumed by header, welcome, and widget FAB |

### Code surfaces (Monaco + syntax highlighter)

Not currently imported anywhere in `src/` — dormant tfy surface, but real:
tfy's own `Markdown` fenced-code rendering depends on it, so dropping tfy
loses it silently unless ported explicitly.

| Current (tfy)                                                                                                           | Target (in-repo)                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `molecules/monacoEditorCore/MonacoEditorCore` (thin `monaco-editor` wrapper: `onMount`/`beforeMount`/`theme`/`options`) | Local `MonacoEditorCore` atom, same prop surface, direct `monaco-editor` dependency                                                          |
| `molecules/SimpleCodeEditor` (copy/download/expand/fullscreen/line-numbers atop `MonacoEditorCore`)                     | Local `CodeEditor` atom (rebuilt on local `MonacoEditorCore`, same feature set)                                                              |
| `molecules/CopyField` / `CopyFieldHighlighted` (copy affordance used by `SimpleCodeEditor`)                             | Fold into local `CodeEditor` copy button; no separate primitive needed                                                                       |
| `react-syntax-highlighter` used internally by tfy `Markdown`/`MarkdownWithOpenUI` for non-OpenUI fenced code            | Local `SyntaxHighlighter` atom, called from the in-repo `Markdown` atom for non-openui fences (same line-numbers / light-dark theme mapping) |

New direct dependencies this implies: `monaco-editor`, `react-syntax-highlighter`
(+ `@types/react-syntax-highlighter`).

## Theme API (target)

```ts
type ThemeMode = "light" | "dark" | "system";

type ThemePreset = "trueforge" | "claude" | "chatgpt" | "gemini";

type SemanticTokens = {
  // Across product
  sidebarBg: string;
  topbarBg: string;
  primaryBg: string;
  secondaryBg: string;
  border: string;
  fontFamily: string; // maps to --font-agent-ui
  // Building blocks
  inputBoxBg: string;
  inputBorder: string;
  textPrimary: string;
  textSecondary: string;
  cardBg: string;
  dropdownSelectedItemBg: string;
  dropdownSelectedItemText: string;
  // Chat
  userMessageBg: string;
  userMessageText: string;
  assistantMessageBg: string;
  assistantMessageText: string;
  // Buttons
  primaryButtonBg: string;
  primaryButtonHover: string;
  primaryButtonText: string;
  secondaryButtonBg: string;
  secondaryButtonHover: string;
  secondaryButtonText: string;
  ghostButtonBg: string;
  ghostButtonHover: string;
  ghostButtonText: string;
  // Status
  successBg: string;
  successText: string;
  failureBg: string;
  failureText: string;
  warningBg: string;
  warningText: string;
  // Kept internals
  focusRing: string;
  radius: string;
  composerRadius: string;
  overlay: string;
  shadowColor: string;
  scrollbarThumb: string;
};

/** UI action icons (send, attach, copy, …) — Lucide, React nodes, or SVG wrappers */
type IconMap = Record<
  string,
  | LucideIcon
  | React.ReactNode
  | ((props: IconProps) => React.ReactNode)
  | React.FC<React.SVGProps<SVGSVGElement>>
>;

/**
 * Brand image sources. `light` / `dark` pick per resolved theme mode and fall
 * back to each other, then to `src`.
 */
type BrandLogoConfig = {
  src?: string;
  light?: string;
  dark?: string;
};

type BrandImage = string | BrandLogoConfig;

/**
 * Product branding — distinct from `icons` (UI chrome).
 * Consumed wherever a product mark appears (header, welcome, widget FAB,
 * empty states, assistant avatar fallback).
 *
 * Images only: to render a component, override the `BrandLogo` slot instead, so
 * brand marks follow the same replacement path as every other atom.
 *
 * Set `mode`, then pass the fields that mode requires:
 * - omit `brand`: TrueForge wordmark / square mark
 * - `icon-title`: `name` + optional `icon`
 * - `icon-only`: `name` + `icon`
 * - `logo`: `name` + `icon` + `logo`
 */
type BrandMode = "icon-title" | "icon-only" | "logo";

type BrandConfig =
  | { mode: "icon-title"; name: string; icon?: BrandImage; logo?: never; href?: string }
  | { mode: "icon-only"; name: string; icon: BrandImage; logo?: never; href?: string }
  | { mode: "logo"; name: string; icon: BrandImage; logo: BrandImage; href?: string };

type ThemeConfig = {
  preset?: ThemePreset; // default: "trueforge"
  mode?: ThemeMode; // omit = uncontrolled (useTheme().setTheme)
  tokens?: Partial<SemanticTokens>;
  brand?: BrandConfig; // set brand.mode, then required fields
  className?: string; // applied on .aui-root (or theme root)
  icons?: IconMap; // full/partial UI icon replace + SVG transforms
  /** Per-surface className hooks for content renderers */
  classNames?: ContentClassNames;
};

/**
 * Override CSS classes (and optional style props) on content engines.
 * All fields optional; merge with defaults via `cn()`.
 */
type ContentClassNames = {
  /** Wrapper / prose root for rendered markdown */
  markdown?: string;
  inlineCode?: string; // Inline code rendered by Markdown
  /** Non-openui fenced code blocks (syntax-highlighter root / pre / code) */
  syntaxHighlighter?: {
    root?: string;
    pre?: string;
    code?: string;
    lineNumber?: string;
  };
  /** OpenUI fenced-block host + common child hooks */
  openui?: {
    root?: string;
    scope?: string;
  };
  /** Monaco editor / diff surfaces */
  monaco?: {
    root?: string;
    editor?: string;
    /** Optional Monaco `theme` id or defineTheme hook name — styling adjacent */
    monacoTheme?: string;
  };
};

type BuiltInLayout = "sidebar" | "drawer" | "dock" | "widget";

/**
 * Shell layout: built-in string **or** a host component that composes
 * exported building blocks (`Thread`, `ThreadListContainer`, …).
 */
type LayoutProp = BuiltInLayout | React.ComponentType<{ className?: string }>;

// Usage — theme + custom layout
function MyLayout({ className }: { className?: string }) {
  return (
    <div className={cn("flex h-full", className)}>
      <aside className="w-64 border-r">
        <ThreadListContainer />
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        <Thread />
      </main>
    </div>
  );
}

<TrueForgeUI
  layout={MyLayout} // or 'sidebar' | 'drawer' | 'dock' | 'widget'
  theme={{
    preset: 'claude',
    mode: 'dark',
    tokens: { primaryButtonBg: '#…', fontFamily: '"My Font", system-ui' },
    brand: {
      mode: 'logo',
      name: 'Acme Agent',
      icon: { light: '/acme-icon.svg', dark: '/acme-icon-dark.svg' },
      logo: { light: '/acme-wordmark.svg', dark: '/acme-wordmark-dark.svg' },
    },
    className: 'my-chat',
    icons: { send: MySendSvg, paperclip: MyAttachSvg },
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

**Resolution order:** preset defaults → `tokens` → `brand` / `icons` →
`classNames` → host CSS variables (documented) → `className` utilities.

Component resolution is separate: the nearest `SlotsProvider` override wins,
then a parent override, then `defaultSlots`. An override receives the exact
props object for that atom; do not assume container-composed content is passed
as `children`.

**Custom styles without the object:** host CSS still works:

```css
.aui-theme-root {
  --primary-button-bg: #e11d48;
  --font-agent-ui: 'My Font', system-ui, sans-serif;
}

/* Or target documented content hooks */
.aui-root .aui-markdown {
  /* … */
}
.aui-root .aui-syntax-highlighter {
  /* … */
}
.aui-root .aui-openui {
  /* … */
}
.aui-root .aui-monaco {
  /* … */
}
```

## Brand system

1. All product marks render through `<BrandLogo />` — one component, never
   hard-coded TFY assets in layouts or atoms. Layouts resolve it via `useSlot`, so
   a host override reaches every call site.
2. Hosts pick chrome with `brand.mode` (`icon-title` | `icon-only` | `logo`).
   Layout chrome uses `resolveBrandChrome(brand)` for expanded/collapsed mark
   variant and whether to show the text title. Custom layouts should call the
   same helper instead of re-deriving fields.
3. `BrandLogo` renders `icon` for compact surfaces. With `variant="logo"`, it
   renders the optional wider logo and falls back to the square icon.
4. `theme.brand` carries **image sources only** (URL or `{ src, light, dark }`).
   Component-valued marks go through the `BrandLogo` slot, so brand replacement
   uses the same mechanism as every other atom instead of a second node-shaped
   escape hatch in the theme config.
5. `theme.brand.name` is required with every mode and always labels configured
   images. Visible title text only appears for `mode: 'icon-title'`. For
   `icon-only` and `logo`, `name` is alt-only.
6. Omitting `brand` keeps the default TrueForge wordmark in expanded chrome and
   the square mark when collapsed. `href` wraps configured images in a same-tab
   link.
7. `{ light, dark }` sources resolve against the provider's theme mode, so a host
   mark tracks light/dark without a custom component. A single configured source
   covers both, so `{ light }` alone never renders a missing image; a config with
   no usable source falls back to the default mark rather than an empty `<img>`.

## Icon system

1. Ship default Lucide map (stable FA-style keys via `IconRegistry`).
2. `theme.icons` merges over defaults (partial or full replace).
3. Allow React SVG / SVGR transform wrappers as values.
4. Custom agent SVGs stay on the SVGR pipeline (`registerAgentIcons`).
5. `useIcon(name)` / `<Icon name="paperclip" />` for all call sites (breaking
   vs string props on tfy `IconButton`).
6. Brand marks are **not** mixed into `icons` — use `theme.brand` so product
   identity stays separate from action icons.

For named UI icons the order is `theme.icons[name]` → registry default. The
robot is also the final brand fallback, so `theme.brand.icon` still takes
precedence over `theme.icons.robot`. Preset-specific icons such as
`welcome-sparkle` and OAuth state icons (`oauth-loading`, `oauth-success`,
`oauth-error`) use the same lookup order.

## Layout override

`TrueForgeUI` / chat shell `layout` prop:

| Value                                               | Behavior                     |
| --------------------------------------------------- | ---------------------------- |
| `"sidebar"` \| `"drawer"` \| `"dock"` \| `"widget"` | Built-in layouts (unchanged) |
| `React.ComponentType<{ className?: string }>`       | Host-owned chrome            |

Custom layouts compose **exported** building blocks (same as today’s advanced
compose path), for example:

- `Thread` / `ThreadContainer`
- `ThreadListContainer`
- `Composer` pieces / slot-backed atoms as needed
- Brand helpers (`BrandLogo`, `resolveBrandChrome`, `useBrandName`) and `useTheme`

The shell still wraps the custom layout with theme + slots + chat provider;
only the chrome tree is replaced. Equivalent to skipping built-in layouts
without dropping providers.

```tsx
import { TrueForgeUI, Thread, ThreadListContainer } from '@truefoundry/trueforge-ui';

function CenteredLayout() {
  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col">
      <ThreadListContainer />
      <Thread />
    </div>
  );
}

<TrueForgeUI
  server={server}
  agentConfig={{ mode: 'SingleAgent', name: 'my-agent' }}
  layout={CenteredLayout}
  theme={{ preset: 'gemini' }}
/>;
```

## Presets (inspired-by)

Ship as CSS variable maps under e.g. `src/theme/presets/`:

| Preset      | Intent (not a clone)                                    |
| ----------- | ------------------------------------------------------- |
| `trueforge` | Current indigo semantic look                            |
| `claude`    | Warm paper bg, soft borders, restrained accent          |
| `chatgpt`   | Cool gray chrome, green/teal send accent, flat bubbles  |
| `gemini`    | Light airy surface, blue accent, slightly larger radius |

Each preset defines **light + dark** token sets. Document that these are
stylistic homages, not product replicas.

## Markdown / OpenUI / syntax-highlighter / Monaco

1. Replace `MarkdownWithOpenUI` with in-repo `Markdown` atom.
2. Keep `@openuidev/*` (already via `openui.css`) as first-party styling
   surface; theme tokens should flow into OpenUI where possible.
3. Fenced code (non-openui): syntax-highlighter themed from semantic tokens
   **and** `theme.classNames.syntaxHighlighter`.
4. Monaco in-repo for rich code / artifact surfaces; style via
   `theme.classNames.monaco` (+ optional `monacoTheme` id).
5. Stable DOM hooks (`aui-markdown`, `aui-syntax-highlighter`, `aui-openui`,
   `aui-monaco`) so host CSS works without the theme object.
6. Preload path: replace `preloadMarkdownOpenUI` with local equivalent.
7. Pass `theme.classNames.markdown` / `openui` into the Markdown/OpenUI hosts.

Supported hooks are `markdown`, `inlineCode`,
`syntaxHighlighter.{root,pre,code,lineNumber}`,
`openui.{root,scope}`, and `monaco.{root,editor,monacoTheme}`.

The standalone MCP OAuth callback selected by `TrueForgeUI` skips server
resolution, but remains inside the same theme and slot provider boundary as the
main shell.

## Call flow

```
TrueForgeUI({ layout, theme, overrides, … })
  └─ SlotsProvider / ThemeProvider
        ├─ apply preset → CSS variables on .aui-root
        ├─ merge theme.tokens / brand / icons / classNames / className
        ├─ layout = built-in | <HostLayout />
        └─ defaultSlots → local shadcn primitives + feature atoms
              ├─ BrandLogo wherever the product mark appears
              └─ Markdown / OpenUI / syntax-highlighter / Monaco
                    (classNames from theme)
```

## Phases

### Phase 0 — Spec freeze

1. Keep this doc as the source of truth.
2. List every tfy import → owner file → replacement (use inventory above).
3. Final `ThemeConfig` + new primitive prop types.

**Done when:** interfaces agreed; inventory complete.

### Phase 1 — Token foundation (no full visual rewrite yet)

1. Stop importing `tfy-web-components/theme.css`.
2. Inline a minimal palette + keep existing semantic `@layer` tokens.
3. Own `ThemeProvider` / `useTheme` (mode light/dark/system); wire
   `SlotsProvider` to it.
4. Apply `theme.className` + CSS vars from `theme.tokens` / `preset` on root.
5. Introduce `BrandConfig` plumbing (`useBrand`, `useBrandName`,
   `<BrandLogo />`) even if defaults still point at TFY assets.

**Done when:** app runs with owned tokens (tfy components may still be present);
host can override `--primary-button-bg` and swap `theme.brand.icon` / `logo`.

### Phase 2 — shadcn primitives + icon + brand registry

1. Add in-repo primitives under `src/atoms/primitives/` (or `src/ui/`).
2. New slot defaults; **break** compound Button / icon-string APIs.
3. Lucide `IconRegistry`; migrate call sites; support `theme.icons`.
4. Wire layouts / welcome / widget FAB / avatar fallbacks to `theme.brand`.
5. Update [`docs/customization.md`](./customization.md) for new override
   contracts (tokens, brand, icons, slots).

**Done when:** no primitive imports from tfy; slots resolve to local components;
brand logo/icon replaceable via theme.

### Phase 3 — Rebuild feature atoms / molecules

1. Replace each tfy agent-chat wrapper with local Tailwind + primitives.
2. Keep slot **names** stable where possible (`AssistantMessageBubble`, …) so
   overrides still work after prop migration.
3. Layouts: remove `IconProvider`; support `layout={MyComponent}` on the shell
   (built-ins unchanged).

**Done when:** `rg tfy-web-components src` is empty; custom layout component
renders inside providers.

### Phase 4 — Markdown + OpenUI + highlighter + Monaco

1. In-repo Markdown + OpenUI fences.
2. Port `react-syntax-highlighter`-based fenced-code rendering out of tfy's
   `Markdown` into a local `SyntaxHighlighter` atom (add direct deps:
   `react-syntax-highlighter`, `@types/react-syntax-highlighter`).
3. Port `MonacoEditorCore` + `SimpleCodeEditor` (copy/download/expand/
   fullscreen/line-numbers) into local `MonacoEditorCore` + `CodeEditor`
   atoms for rich code / artifact surfaces (lazy-load where possible; add
   direct dep `monaco-editor`).
4. Wire `theme.classNames` (`markdown`, `syntaxHighlighter`, `openui`,
   `monaco`) + stable `aui-*` hooks for host CSS.
5. Fix tests that mock `tfy-markdown-openui`.

**Done when:** OpenUI / code fences / Monaco render without tfy; classNames
overrides apply in the example app.

### Phase 5 — Presets + polish

1. Ship `claude` / `chatgpt` / `gemini` / `trueforge` packs.
2. Example app: theme switcher + custom layout demo + content classNames demo.
3. Drop `tfy-web-components` from `dependencies` / `peerDependencies`.
4. CHANGELOG + migration guide (slot props, styles, brand, layout, classNames).

**Done when:** presets + custom layout + content classNames demos work; package
no longer depends on tfy.

## Migration notes (for consumers)

- Remove `@import "tfy-web-components/theme.css"`.
- Styles auto-inject from `ThemeProvider` (optional
  `@import "@truefoundry/trueforge-ui/styles.css"` for SSR). Tokens are scoped
  to `.aui-theme-root` — the host document is not rethemed.
- Revisit `overrides` for `Button` / `IconButton` / bubbles (new props).
- Prefer
  `theme={{ preset, tokens, brand, icons, className, classNames }}`
  over hacking a third-party theme.
- Replace product marks with `theme.brand.icon` and optional wide `logo` (URLs
  or per-mode sources), or
  override the `BrandLogo` slot for component marks.
- Pass `layout={MyLayout}` to own chrome; compose `Thread` /
  `ThreadListContainer` / etc.
- Style content engines via `theme.classNames` or `.aui-markdown` /
  `.aui-syntax-highlighter` / `.aui-openui` / `.aui-monaco`.

## Non-goals (v1)

- Pixel-perfect Claude / ChatGPT / Gemini clones
- Dual-running tfy + shadcn
- Moving structural atom overrides into `theme` (those stay in `overrides`;
  full chrome uses `layout` instead)
- Runtime / Server abstraction work (see [`docs/server.md`](./server.md))

## PR sequence

1. Tokens + owned ThemeProvider (still on tfy components if needed mid-migration)
2. Primitives + IconRegistry + slot API break
3. Feature atoms migration (can split by domain: chrome → tools → messages)
4. Custom `layout` component support
5. Markdown / OpenUI / syntax-highlighter / Monaco + `theme.classNames`
6. Presets + remove tfy dep + example + docs

## Success criteria

- `rg tfy-web-components src` → empty
- Four presets + custom `tokens` / `brand` / `icons` / `className` /
  `classNames` demo in example
- Host can pass `layout={MyLayout}` built from `Thread` + thread list exports
- Host can override classes on Markdown, syntax-highlighter, OpenUI, and Monaco
  via `theme.classNames` and/or stable `aui-*` CSS hooks
- Host can fully rebrand (colors, fonts, logo image, action icons) without slot
  overrides; component-valued marks use the `BrandLogo` slot
- Host can still replace any component via `overrides` when needed
- Light/dark controlled + uncontrolled both work
- Slot override of `Button` works with new API
- OpenUI fenced blocks still render
- No hard-coded TrueFoundry logo/mark outside default `theme.brand` assets
