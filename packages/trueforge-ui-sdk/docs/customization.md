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
<TrueforgeUI
  layout="sidebar"
  theme={{
    preset: 'claude',
    mode: 'dark',
    tokens: { primary: '#e11d48' },
    brand: { name: 'Acme', logo: '/brand/logo.svg' },
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

Presets: `truefoundry` (default), `claude`, `chatgpt`, `gemini` — stylistic
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
  `AgentsLibrary`, `AgentsLibraryButton`, `SaveAgentButton`,
  `SelectAgentEmptyState`, `ClearChatButton`
- **Attachments / toasts:** `AttachmentCard`, `AttachmentPreviewDialog`,
  `AttachmentPickerButton`, `Toast`, `ToastStack`
- **Tools / prompts:** `ToolCallCard`, `ToolCallContentBlock`,
  `ToolApprovalBar`, `ToolGroupCard`, `SubAgentCard`, `SandboxToolCallCard`,
  `AgentStepsCard`, `ReasoningCard`, `AskUserPrompt`, `McpAuthPrompt`

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

<TrueforgeUI layout={CenteredLayout} server={server} agentMode={…} />;
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
