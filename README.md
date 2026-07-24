# TrueFoundry harness workspace

pnpm workspace with:

| Package               | Path                                   | Role                                               |
| --------------------- | -------------------------------------- | -------------------------------------------------- |
| `@truefoundry/utils`  | [`packages/harness`](packages/harness) | Published library (`core` + `agent-session`)       |
| `@truefoundry/server` | [`packages/server`](packages/server)   | Future CLI/HTTP server (private; depends on utils) |

## Develop

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Library imports

```ts
import { AgentThread } from '@truefoundry/utils/core';
import { Sessions } from '@truefoundry/utils/agent-session';
```

Or namespaced:

```ts
import { core, agentSession } from '@truefoundry/utils';
```

Server-only deps (`hono`, `@hono/node-server`, `@hono/swagger-ui`, `yaml`) live in `packages/server` and never reach library consumers.
