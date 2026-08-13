# Public API

Curated exports from `@truefoundry/trueforge-ui`. Design-system **component
values** (`Button`, `Modal`, …) live on `tfy-web-components` — this package
re-exports override **types** only where needed.

## Quick start

| Export                           | Notes                             |
| -------------------------------- | --------------------------------- |
| `TrueforgeUI`                    | Slots + runtime + built-in layout |
| `TrueforgeUIProps`, `ChatLayout` | Props / layout union              |

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

| Export                                         | Notes                    |
| ---------------------------------------------- | ------------------------ |
| `ButtonProps`, `ButtonSize`, `IconButtonProps` | Slot override contracts  |
| Atom `*Props` types                            | Per-atom override shapes |

## Styles

| Export path                            | Notes                                                 |
| -------------------------------------- | ----------------------------------------------------- |
| `@truefoundry/trueforge-ui/styles.css` | Tokens + utilities + OpenUI (optional; auto-injected) |
