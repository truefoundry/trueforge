# Public API

Curated exports from `@truefoundry/trueforge-ui`. Design-system primitives
(`Button`, `CenteredModal`, `Switch`, …) are owned in this package. Low-level
controls are styled via theme tokens / CSS rather than `SlotsProvider` slots.

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

The Harness factory includes the optional `AgentMetricsServer` port used by the
agent-detail Metrics tab. Custom servers can provide `metrics` with
`getCharts`, `getMeters`, and `getChartData`; access it with
`useAgentMetricsServer` / `useOptionalAgentMetricsServer`. The default visual
surface is split across the `AgentMetrics`, `AgentMetricsView`,
`AgentMetricsTimeRangeFilter`, `AgentMetricCard`, and `AgentMetricChart` slots.

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

| Export                                       | Notes                                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------------------- |
| `Button`                                     | `Button.Primary`, `.Secondary`, `.Ghost`, or `.Destructive`; no direct `<Button />` |
| `ButtonProps`, `ButtonSize`, `ButtonVariant` | Button prop contracts (`small`, `medium`, or `large`)                               |
| `IconButton`                                 | Matching compound variants for square icon-only buttons                             |
| `IconButtonProps`                            | Icon button prop contract                                                           |
| Atom `*Props` types                          | Per-atom override shapes                                                            |

```tsx
<Button.Primary size="medium" type="submit">
  Save
</Button.Primary>
<Button.Ghost size="small" onClick={onCancel}>
  Cancel
</Button.Ghost>
```

## Styles

| Export path                            | Notes                                                 |
| -------------------------------------- | ----------------------------------------------------- |
| `@truefoundry/trueforge-ui/styles.css` | Tokens + utilities + OpenUI (optional; auto-injected) |
