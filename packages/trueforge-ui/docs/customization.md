# Customizing the UI

Every curated feature atom is resolved through `useSlot`. Override via
`SlotsProvider`; nested providers fall through to parents / defaults.
Primitives (`Button`, `IconButton`, `Dialog`, …) are direct imports — not
slots — so style them via theme tokens / CSS, or fork the host layout.

```tsx
import { SlotsProvider, Thread } from '@truefoundry/trueforge-ui';

function MyWelcome({ heading }: { heading?: string }) {
  return <p className="px-4 py-6 text-center text-lg">{heading ?? 'What are we building today?'}</p>;
}

<SlotsProvider overrides={{ WelcomeScreen: MyWelcome }}>
  <Thread />
</SlotsProvider>;
```

## Theme object

Prefer `theme={{ preset, mode, tokens, brand, icons, className, classNames }}`
over hacking third-party CSS:

```tsx
<TrueForgeUI
  layout="sidebar"
  theme={{
    preset: 'claude',
    mode: 'dark',
    tokens: { primary: '#e11d48' },
    brand: { mode: 'logo', name: 'Acme', icon: '/brand/icon.svg', logo: '/brand/wordmark.svg' },
    icons: { send: MySendSvg },
    classNames: {
      markdown: 'prose max-w-none',
      inlineCode: 'font-semibold',
      syntaxHighlighter: { root: 'rounded-lg', lineNumber: 'opacity-60' },
      openui: { root: 'my-openui', scope: 'p-2' },
      monaco: { root: 'h-64', editor: 'rounded-lg', monacoTheme: 'vs-dark' },
    },
  }}
/>
```

Presets: `trueforge` (default), `claude`, `chatgpt`, `gemini` — stylistic
homages, not product replicas. Host CSS still works on `.aui-root` /
`.aui-markdown` / `.aui-syntax-highlighter` / `.aui-openui` / `.aui-monaco`.

## Slot coverage

Public override surface (primitives stay theme/CSS — not slots):

- **Layout / composer:** `Accordion`, `AccordionSummary`, `AccordionDetails`,
  `ComposerShell`, `ComposerLeftSection`, `ComposerRightSection`,
  `ComposerSendButton`, `DraftComposerLeftSection`,
  `DraftComposerRightSection`, `DraftCompositeSelector`, `DraftModelSelector`,
  `ThreadRootShell`, `ThreadViewportShell`,
  `ThreadComposerAreaShell`, `MessageGroup`, `ScrollToBottomButton`,
  `MessageListSkeleton`, `WelcomeScreen`
- **Messages / content:** `AssistantMessageBubble`, `UserMessageBubble`,
  `UserMessageEdit`, `UserMessageActionBar`, `MessageActionBar`,
  `MessageErrorBanner`, `MessageIndicator`, `MessageTimestamp`, `Markdown`,
  `SyntaxHighlighter`, `OpenUiFenceBlock`, `SandboxArtifactDownload`,
  `ChatFileDownload`, `MonacoEditorCore`, `CodeEditor`
- **Thread list:** `ThreadListShell`, `ThreadListNewButton`, `ThreadListRow`,
  `ThreadListRowSkeleton`, `ThreadListEmptyState`, `HistoryLoader`,
  `AgentsLibrary`, `AgentsLibraryButton`, `SessionsBrowserButton`,
  `SaveAgentButton`, `SelectAgentEmptyState`, `ClearChatButton`
- **Agent details / sessions:** `AgentDetailsPage`, `AgentDetailsHeader`,
  `AgentDetailsTabs`, `AgentDetailsUnavailable`, `AgentOverview`,
  `AgentOverviewCard`, `AgentSessions`, `AgentSessionsFilters`, `SessionsPage`,
  `AgentSessionListRow`, `AgentSessionDetailHeader`, `AgentSessionMetricsStrip`,
  `AgentSessionTimelineContainer`, `AgentSessionEventTimeline`,
  `AgentSessionEventTimelineChart`, `AgentSessionTurnHeader`,
  `AgentCodeSnippets`, `AgentCodeBlock`
- **Attachments / toasts:** `AttachmentCard`, `AttachmentPreviewDialog`,
  `AttachmentPickerButton`, `Toast`, `ToastStack`
- **Tools / prompts:** `ToolCallCard`, `ToolCallContentBlock`,
  `ToolApprovalBar`, `ToolGroupCard`, `SubAgentCard`, `SandboxToolCallCard`,
  `AgentStepsCard`, `ReasoningCard`, `AskUserPrompt`, `McpAuthPrompt`,
  `ResumeUnavailable`

## URL routing (`withRouter`)

Opt in to browser-URL sync for shell navigation. Requires `react-router-dom`
(v6 or v7) in the host; it is an optional peer and stays out of the bundle
unless `withRouter` is set, so dock/widget embeds and hosts that own their own
router should leave it off (the default).

```tsx
<TrueForgeUI server={server} layout="sidebar" withRouter />
```

Places mirrored to the URL:

- `/` — new chat / library landing (mode-dependent)
- `/agents/:agentName` — immutable "Try" of a library agent
- `/sessions` — all-user Sessions browser (named agents and drafts)
- `/sessions/:sessionId` — a specific chat session
- `/settings` — settings overlay (closing navigates to the chat place below it)
- `/library` — Agents Library
- `/library/:agentId` — agent details. `?tab=overview|sessions|code` selects the tab (default Overview)

Customize the paths (only honored when `withRouter`). Set any entry to `false`
to keep that place overlay-only with no URL:

```tsx
<TrueForgeUI
  server={server}
  withRouter
  routes={{
    basename: '/app',
    paths: { session: '/chats/:sessionId', libraryAgent: '/library/:agentId', settings: false },
  }}
/>
```

Custom `agent` / `session` / `libraryAgent` templates must keep their `:param` segment, or the
place can be written to the URL but not read back.

Shell state stays the source of truth; the router mirrors it. Combining
`withRouter` with `initialSessionId` is not supported — the URL wins.

Notes on behaviour:

- Hashes and host-owned query keys are preserved across navigation. Session
  keys (`sessionId`, `agentId`, `tab`, `view`, `s_tw`, `s_sts`, `s_ets`) are
  removed when the destination does not own them, preventing stale filters or
  selections from leaking into unrelated routes.
- A copied library session link is `?agentId=&sessionId=` on the current page
  (plus `/library/:agentId` when `withRouter`). Opening it lands on that
  agent's Sessions tab. Clicking an agent in the library writes `?tab=overview`
  so a leftover chat `sessionId` does not open Sessions. The same query works
  when `withRouter` is off.
- The all-user Sessions page is `/sessions` when `withRouter` is on, or
  `?view=sessions` when it is off. Agent and time filters live in the query
  (`agentId`, `s_tw` for a relative window, or `s_sts`/`s_ets` for an absolute
  range). Opening a session pins `s_sts`/`s_ets` around `created_at` (±5 min)
  so a refresh still finds that row on page 1 without scrolling the list.
- A `/sessions/:sessionId` link is resolved through `getSession` so the chat
  opens with its own agent binding and mutability rather than as a new draft.
- Unrecognized paths (and malformed escapes) normalize to the root place.
- A URL naming a place the host cannot honor (e.g. `/agents/x` without the
  agent library, or `/settings` when the settings capability is disabled) is
  left in the address bar until the next navigation corrects it.

Hosts serving the SDK must send the app shell for unknown paths (SPA
fallback), otherwise deep links 404 before React boots.

## Custom layout

Pass a React component as `layout` to own chrome; compose exported
`Thread` / `ThreadListContainer` / brand helpers:

```tsx
function CenteredLayout({ className }: { className?: string }) {
  return (
    <div className={`mx-auto flex h-full max-w-3xl flex-col ${className ?? ""}`}>
      <ThreadListContainer />
      <Thread />
    </div>
  );
}

<TrueForgeUI layout={CenteredLayout} server={server} agentMode={…} />;
```

## Restyle bubbles

```tsx
import { SlotsProvider, Thread, type AssistantMessageBubbleProps } from '@truefoundry/trueforge-ui';

function AssistantBubbleV2({ children, error, actionBar }: AssistantMessageBubbleProps) {
  return (
    <div className="mr-auto max-w-[75%] rounded-2xl bg-neutral-100 px-4 py-2">
      {children}
      {error}
      {actionBar}
    </div>
  );
}

<SlotsProvider overrides={{ AssistantMessageBubble: AssistantBubbleV2 }}>
  <Thread />
</SlotsProvider>;
```

See [theming.md](./theming.md) for the full hard-cut design and migration notes.
