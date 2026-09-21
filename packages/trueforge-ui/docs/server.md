# Server configuration

`<TrueForgeUI />` accepts either the built-in TrueForge server configuration or a ready `AgentUIServer`.

## Built-in TrueForge server

```tsx
<TrueForgeUI
  server={{
    type: 'trueforge',
    baseUrl: '/',
    token,
    // fetch: authAwareFetch,
  }}
  layout="sidebar"
/>
```

`baseUrl` defaults to the current origin. Use `token` for bearer authentication or provide a custom `fetch` for cookie sessions and interceptors. Optional `catalog` and `permissions` ports override the built-in implementations.

## Custom server

Pass a complete `AgentUIServer` directly; there is no `{ type: 'custom' }` wrapper.

```tsx
import { TrueForgeUI, type AgentUIServer } from '@truefoundry/trueforge-ui';

const server: AgentUIServer = {
  // Implement chat and builder ports.
};

<TrueForgeUI server={server} layout="sidebar" />;
```

The canonical contracts live in `@truefoundry/assistant-ui-runtime/server` and are re-exported by `@truefoundry/trueforge-ui`. Hosts should import them from the UI package.

Use `createTrueForgeServer` to compose separately implemented chat, builder, catalog, session, metrics, schedule, and permissions ports into one `AgentUIServer`.
