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

## Run the server

Create the local environment and registry files from the tracked examples:

```bash
cp packages/server/.env.example packages/server/.env
cp -R packages/server/registry-example packages/server/registry
```

Fill in `MODEL_API_KEY` in `packages/server/.env`, then start the server:

```bash
pnpm dev:server
```

To build and run it with Docker instead:

```bash
docker compose up --build
```

The local `.env` file and `packages/server/registry/` directory are ignored by Git. Docker Compose requires the environment file and mounts the registry read-only into the container.

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
