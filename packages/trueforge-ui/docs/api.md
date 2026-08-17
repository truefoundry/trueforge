# Public API

Curated exports from `@truefoundry/trueforge-ui`. Design-system primitives
(`CenteredModal`, `Switch`, …) are owned in this package. Low-level controls
like `Button` / `IconButton` are styled via theme tokens / CSS (not
`SlotsProvider` slots); their **prop types** (`ButtonProps`, `IconButtonProps`,
…) are exported for hosts that build around those contracts. Component
**values** appear below only when they are part of the public surface.

## Quick start

| Export                           | Notes                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `TrueForgeUI`                    | Slots + runtime + built-in layout                                                    |
| `TrueForgeUIProps`, `ChatLayout` | Props / layout union                                                                 |
| `TrueForgeServerConfig`          | `server` prop: `type: "truefoundry"` \| `type: "trueforge"` \| ready `AgentUIServer` |

### Built-in servers

| `server` config                                                      | What the SDK does                                                                       |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `{ type: 'truefoundry', apiKey, controlPlaneURL, gatewayPlaneURL? }` | Calls runtime `createTrueFoundryAgentUIServer`                                          |
| `{ type: 'trueforge', baseUrl?, token?, fetch?, catalog? }`          | Dynamic-imports `plugins/trueforge-agent-server-adapter` → full Harness `AgentUIServer` |
| Ready `AgentUIServer`                                                | Passthrough (host-composed or `createTrueFoundryServer`)                                |

TrueForge hosts need `@truefoundry/trueforge-sdk`. Cookie apps pass `fetch`; embeds usually pass `token`.

```tsx
// Harness / TrueForge
<TrueForgeUI
  server={{ type: 'trueforge', baseUrl: '/', token: process.env.TRUEFORGE_TOKEN }}
  layout="sidebar"
/>

// Or same-origin cookies:
<TrueForgeUI server={{ type: 'trueforge', fetch: authAwareFetch }} layout="sidebar" />
```

Factory without `<TrueForgeUI />`:

```ts
import { createTrueForgeAgentUIServer } from '@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter';

const server = createTrueForgeAgentUIServer({ baseUrl: '/', token });
```

## Compose

| Export                                                        | Notes                           |
| ------------------------------------------------------------- | ------------------------------- |
| `TrueFoundryChatProvider`                                     | Named-agent runtime + toasts    |
| `TrueFoundryChatProviderProps`                                | `client` XOR `apiKey`+`baseUrl` |
| `Thread`                                                      | Full thread + composer          |
| `ThreadContainer`, `ComposerContainer`, `ThreadListContainer` | Building blocks                 |
| `ToasterProvider`, `useToaster`, `useToasterOptional`         | Success and error toasts        |
| Other `*Container` exports                                    | Advanced message / tool wiring  |

## Slots / theme

| Export                                                               | Notes                       |
| -------------------------------------------------------------------- | --------------------------- |
| `SlotsProvider`, `useSlot`, `defaultSlots`                           | Override registry           |
| `SlotOverrides`, `AtomSlots`, `ThemeMode`                            | Types                       |
| `useTheme`, `useThemeMode`                                           | Theme mode                  |
| Feature atoms (`WelcomeScreen`, `ComposerShell`, bubbles, toasts, …) | Defaults + override targets |

## Chrome / runtime

| Export                                                                                | Notes                                         |
| ------------------------------------------------------------------------------------- | --------------------------------------------- |
| `useAui`, `useAuiState`, `AssistantState`                                             | Also `@truefoundry/trueforge-ui/assistant-ui` |
| `AgentSessionClient`                                                                  | Gateway client                                |
| `useTrueFoundryAgentRuntime`, `trueFoundryAttachmentAdapter`, other `useTrueFoundry*` | Runtime hooks                                 |

## Types for overrides

| Export                                         | Notes                                                            |
| ---------------------------------------------- | ---------------------------------------------------------------- |
| `ButtonProps`, `ButtonSize`, `IconButtonProps` | Prop contracts for in-package primitives (tokens/CSS, not slots) |
| Atom `*Props` types                            | Per-atom override shapes                                         |

## Styles

| Export path                            | Notes                                                 |
| -------------------------------------- | ----------------------------------------------------- |
| `@truefoundry/trueforge-ui/styles.css` | Tokens + utilities + OpenUI (optional; auto-injected) |
