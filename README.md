# TrueForge

TrueForge is an open-source agent harness: the runtime layer that turns an LLM into a working agent. It runs the execution loop — model calls, tool use, context, and session state — and exposes the result as a chat UI, an HTTP API, and a TypeScript library.

Out of the box you get multi-turn sessions with streaming, MCP tool servers (including OAuth), skills, sandboxed code execution, human-in-the-loop approvals, and subagents. Configure providers in the UI or via the settings APIs; run as a single process on SQLite, or scale out with Postgres and Redis.

> Note: Package and folder names will be renamed soon to match the release names below. They have been intentionally named "utils" to not leak before announcement.

| Package                   | Release Name                  | Path                                     | What it is                                                  |
| ------------------------- | ----------------------------- | ---------------------------------------- | ----------------------------------------------------------- |
| `@truefoundry/utils`      | `@truefoundry/trueforge`      | `[packages/server](packages/server)`     | Agent server + bundled UI                                   |
| `@truefoundry/utils-core` | `@truefoundry/trueforge-core` | `[packages/harness](packages/harness)`   | Library: agent core, sessions, and streaming                |
| `trueharness`             | `@truefoundry/trueforge-sdk`  | `[packages/sdk](packages/sdk)`           | Generated TypeScript SDK                                    |
| `frontend`                | —                             | `[packages/frontend](packages/frontend)` | Chat UI (bundled into the server; not published on its own) |

Requires **Node.js 22.13+** and **pnpm**.

## Run from source

```bash
pnpm install
cp packages/server/.env.example packages/server/.env
```

### Standalone (local, zero infra)

SQLite only — good for trying the product or single-process use.

```bash
pnpm standalone:dev
```

- UI (Vite): [http://localhost:3000](http://localhost:3000) — proxies `/api/*` to the API
- API: [http://localhost:8790](http://localhost:8790)

### Multi-replica (Postgres + Redis)

Use this when you need more than one server process (cancels and turn streams peer over Redis).

Terminal 1 — start Postgres (`:5432`) and Redis (`:6379`):

```bash
pnpm dev:infra
```

Terminal 2:

```bash
pnpm dev
```

- UI (Vite): [http://localhost:3000](http://localhost:3000) — proxies `/api/*` to the API
- API: [http://localhost:8790](http://localhost:8790)

|           | Standalone                             | Multi-replica                                   |
| --------- | -------------------------------------- | ----------------------------------------------- |
| Process   | One server                             | One or more replicas with Redis peering         |
| Database  | SQLite                                 | Postgres                                        |
| Infra     | None                                   | Postgres + Redis (`pnpm dev:infra` or your own) |
| Dev       | `pnpm standalone:dev`                  | `pnpm dev` (after infra)                        |
| Prod-like | `pnpm build` → `pnpm standalone:start` | `pnpm build` → `pnpm start`                     |

Migrations run on server startup. To run Postgres migrations without starting HTTP:

```bash
pnpm --filter @truefoundry/utils migrate
```

That script sets `STANDALONE=false` and uses `POSTGRES_*` from `packages/server/.env`. It will not run in standalone mode (SQLite migrations happen on boot instead).

### Serving the UI from the server

Dev and production-like runs use different process topologies. Standalone vs multi-replica only changes storage/peering (`STANDALONE`); it does not change how the UI is served.

**Development** — `pnpm standalone:dev` / `pnpm dev` run two processes in parallel: Vite (UI, with live reload) and the Hono API. The browser talks to Vite; Vite proxies `/api/`* to Hono.

```
  browser                     Vite (:3000)                   Hono (:8790)
     │                             │                              │
     │  GET /  (UI)                │                              │
     │────────────────────────────>│                              │
     │                             │                              │
     │  /api/*                     │  proxy                       │
     │────────────────────────────>│─────────────────────────────>│
```

**Production-like** — after `pnpm build`, `pnpm standalone:start` / `pnpm start` run a single Hono process. It serves the built frontend bundle for non-API routes and handles `/api/`* itself. The Docker container works the same way: one process, one origin.

```
  browser                                    Hono (:8790)
     │                                            │
     │  GET /  (static UI from dist/_frontend)    │
     │───────────────────────────────────────────>│
     │                                            │
     │  /api/*                                    │
     │───────────────────────────────────────────>│
```

Open the UI on `:3000` in dev, or on the API port (`:8790`) when the server is serving the bundle.

## Configuration

Model providers, MCP servers, skills, and sandboxes are configured in the UI under **Settings**, or via the settings APIs. Discovery presets come from the `*/catalog` endpoints. Interactive API docs are at `/api/v1/docs`.

See `[packages/server/.env.example](packages/server/.env.example)` for every env var.

Useful overrides:

- `PORT` — API port (default `8790`)
- `FRONTEND_PORT` — Vite UI port in dev (default `3000`); see `[packages/frontend/README.md](packages/frontend/README.md)`
- `VITE_SERVER_URL` — point the Vite proxy at a different API
- `FRONTEND_DIR` — directory of a built UI for the server to serve
- `SQLITE_PATH` — SQLite file location in standalone mode
- `REDIS_URL` / `POSTGRES_*` — used when `STANDALONE=false`

On one origin (start / Docker): `/api/*` (including OpenAPI) and `/healthz` are the API; everything else is the UI. The server prefers a packaged `dist/_frontend`, then `packages/frontend/dist`. With no UI build present it serves the API only (normal for Vite-backed `pnpm dev`). See [Serving the UI from the server](#serving-the-ui-from-the-server).

## Use as a library

```ts
import { AgentThread } from '@truefoundry/utils-core/core';
import { Sessions } from '@truefoundry/utils-core/agent-session';
```

Or namespaced:

```ts
import { core, agentSession } from '@truefoundry/utils-core';
```

The published package supports both CommonJS and ESM. Server-only dependencies (Hono, SQLite, Postgres, Redis, etc.) stay in `@truefoundry/utils` and are not pulled in by library consumers.

## Development

| Script                                               | Purpose                                               |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `pnpm standalone:dev` / `pnpm dev`                   | Local UI + API (see modes above)                      |
| `pnpm standalone:dev:no-watch` / `pnpm dev:no-watch` | Same, but the server does not restart on file changes |
| `pnpm dev:server:ui`                                 | Packed UI + watched API (no Vite)                     |
| `pnpm build`                                         | Build all packages                                    |
| `pnpm test` / `pnpm typecheck`                       | Workspace checks                                      |
| `pnpm smoke` / `pnpm smoke:down`                     | Full Docker Compose stack                             |
| `pnpm clean` / `pnpm clean:all`                      | Remove build outputs (+ `node_modules` for `:all`)    |

Local server scripts resolve `@truefoundry/utils-core` from source, so you do not need a utils-core `dist/` build for `pnpm dev` / `standalone:dev`.

### Smoke test (Docker)

Full stack in containers — built server image serves API + UI. Forces multi-replica mode (`STANDALONE=false`):

```bash
pnpm smoke       # build, wait for healthy services, check /healthz and UI
pnpm smoke:down
```

Open [http://localhost:8791](http://localhost:8791). Credentials come from `packages/server/.env`. Host ports differ from local dev so they do not collide: Postgres `:5433`, Redis `:6380`, app `:8791`.

### Entry points

| File           | Used by                                       | Role                                        |
| -------------- | --------------------------------------------- | ------------------------------------------- |
| `dist/main.js` | Docker, `pnpm start`, `pnpm standalone:start` | Env-only server boot                        |
| `dist/cli.js`  | `npx @truefoundry/trueforge`                  | CLI (`--help`, `--port`), then loads `main` |

### Generated SDK and OpenAPI

`packages/sdk` and `fern/openapi/openapi.json` are generated by [Fern](https://buildwithfern.com) and committed. Edit route handlers under `packages/server/src/routes/`, not the generated output. CI regenerates them; to run locally (Docker required):

```bash
pnpm sdk:generate
```
