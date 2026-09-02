# Compatibility

Peer and dependency ranges for `@truefoundry/trueforge-ui` (see
`package.json` for authoritative versions).

**Status:** this package is `0.x` (APIs may change). It currently depends on
`truefoundry-gateway-sdk@^0.4.0-rc.6` — pin with a lockfile for reproducible
installs until a stable gateway release is adopted.

## Required peers

| Package               | Range          |
| --------------------- | -------------- |
| `react` / `react-dom` | `^18 \|\| ^19` |

Install once at the app root.

## Bundled dependencies (installed with the SDK)

| Package                             | Range      |
| ----------------------------------- | ---------- |
| `@assistant-ui/core`                | `^0.2.22`  |
| `@assistant-ui/react`               | `^0.14.24` |
| `@truefoundry/assistant-ui-runtime` | `0.1.25`   |
| `truefoundry-gateway-sdk`           | `^0.4.0`   |
| `lucide-react`                      | `^0.562.0` |

`@assistant-ui/*` are also listed as **optional** peers so hosts that install
them directly for customization stay on a compatible range.

Runtime + gateway are wired by `TrueFoundryChatProvider` and re-exported for
advanced use. `lucide-react` supplies default UI icons via `IconRegistry`;
hosts may override via `theme.icons` or register custom SVGR components.

## Optional direct install (customization)

Chrome hooks (`useAui`, `useAuiState`, `useTheme`) are re-exported from
`@truefoundry/trueforge-ui` — prefer those so the host shares the SDK instance.

When importing deep `@assistant-ui/react` primitives or `@assistant-ui/core`
from host code, also add them as direct dependencies at versions within the
ranges above so resolution is app-rooted. Force a singleton (Vite `dedupe`,
Yarn `resolutions`, npm `overrides`) so the SDK and host share one copy — see
README Troubleshooting.

## Singletons

These must resolve to one physical copy in the dependency graph:

- `react` / `react-dom`
- `@assistant-ui/core` / `@assistant-ui/react` / `@assistant-ui/store`
