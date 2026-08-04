# TrueFoundry harness workspace

pnpm workspace with:

| Package                   | Path                                     | Role                                                  |
| ------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `@truefoundry/utils-core` | [`packages/harness`](packages/harness)   | Published library (`core` + `agent-session`)          |
| `@truefoundry/utils`      | [`packages/server`](packages/server)     | Published app + CLI (`npx @truefoundry/utils`)        |
| `frontend`                | [`packages/frontend`](packages/frontend) | Private draft-only agent chat UI (bundled into utils) |

## Development

The API and frontend run on the host with hot reload. Postgres and Redis run in Docker.

### One-time setup

```bash
pnpm install
cp packages/server/.env.example packages/server/.env
```

For this host-dev flow, set `SINGLE_BINARY=false` in `packages/server/.env` so the server uses the Compose Postgres/Redis defaults. Configure model providers (API keys and endpoints) in the UI under Settings, or via `PUT /api/v1/settings/model-providers` — discovery presets come from `GET /api/v1/settings/model-providers/catalog`. MCP servers, skills, and sandbox providers use the same settings pattern when you need them.

### Day-to-day

Terminal 1:

```bash
pnpm dev:infra   # Postgres + Redis (data in ./data/dev/postgres); Ctrl+C stops them
```

Terminal 2:

```bash
pnpm dev         # API on :8790 and Vite on :3000
```

Open `http://localhost:3000`. Frontend changes update through Vite HMR; server changes automatically restart the API on `:8790`. Vite proxies `/api/*` to the API. Local server scripts resolve `@truefoundry/utils-core` from source (`exports.development`), so a utils-core `dist/` build is not required for `pnpm dev`. For drain testing without server hot reload, use `pnpm dev:no-watch` instead of `pnpm dev`.

The workspace utils-core package is ESM so the host server and source schemas share one ESM dependency graph. `NODE_OPTIONS=--conditions=development` selects `src/` at runtime, and TypeScript uses the same condition for source-based static analysis. Development, lint, typecheck, tests, OpenAPI generation, and migrations do not read or recreate `packages/harness/dist`; release builds, package checks, and Docker smoke tests create it intentionally.

Root `pnpm dev` watches utils-core sandbox Python helpers and server catalog YAML, regenerates the matching TypeScript modules, and lets the server watcher restart normally. Neither path builds `dist`.

| Script              | Runs                                                                    |
| ------------------- | ----------------------------------------------------------------------- |
| `pnpm dev:infra`    | Postgres + Redis in the foreground                                      |
| `pnpm dev`          | Sandbox/catalog generators + server (`tsx watch`) + Vite                |
| `pnpm dev:no-watch` | Same stack without server file watching (still `NODE_ENV=development`)  |
| `pnpm clean`        | Workspace build outputs and the ESLint cache                            |
| `pnpm clean:all`    | The same outputs plus all workspace `node_modules`                      |
| `pnpm server:bin`   | Built CLI (`node dist/cli.js`) — same entry as `npx @truefoundry/utils` |

Migrations run automatically on server startup. To migrate Postgres without starting HTTP:

```bash
pnpm --filter @truefoundry/utils migrate
```

Zero-env single-binary (SQLite + UI), same path as published `npx` — leave `SINGLE_BINARY=true` (the `.env.example` default) and skip `pnpm dev:infra`:

```bash
pnpm clean
pnpm build
pnpm server:bin
# or after publish: npx @truefoundry/utils
```

Workspace checks:

```bash
pnpm build
pnpm test
pnpm typecheck
```

Root `build` / `typecheck` (and CI) include utils-core, server, and frontend. `FRONTEND_PORT` moves Vite off `:3000`, `VITE_SERVER_URL` points it at another API. See [`packages/frontend/README.md`](packages/frontend/README.md).

## Serving the UI from the server

Deployments are one process on one origin: `/api/*` (including `/api/v1/docs` and `/api/v1/openapi.json`) and
`/healthz` are the API, everything else resolves to the UI. Frontend resolution prefers packaged
`dist/frontend` (npm tarball / Docker / `pnpm server:bin`), then the monorepo sibling
`packages/frontend/dist` (host-dev before a copy). Override with `FRONTEND_DIR` if needed. With no
build at that path the server logs a warning and serves the API only, which is what running the
server behind Vite needs.

## Docker Compose smoke test

Full stack in containers — built server image serves API + UI (no Vite HMR). Smoke forces
`SINGLE_BINARY=false` (Postgres + Redis):

```bash
pnpm smoke       # build, wait for healthy services, then check /healthz and the UI app shell
pnpm smoke:down  # stop the stack
```

Open `http://localhost:8791`. Secrets and Postgres credentials come from `packages/server/.env`. Host ports and in-network DB/Redis targets are fixed in Compose so they do not collide with development: Postgres `:5433`, Redis `:6380`, app `:8791` (vs `pnpm dev:infra` on `:5432`/`:6379` and `pnpm dev` on `:8790`/`:3000`).

Requires `packages/server/.env`. `.env` and `data/` are gitignored. Development infra stores Postgres under `./data/dev/postgres`.

## SDK generation

`packages/sdk` and `fern/openapi/openapi.json` are both generated by
[Fern](https://buildwithfern.com) and committed — edit `packages/server/src/routes/`, never the
output. [`generate-sdk.yaml`](.github/workflows/generate-sdk.yaml) regenerates them on every change;
see its comments for the flags if you need to run it by hand (Docker required):

```bash
pnpm openapi:write
fern check && fern generate --group ts-sdk --version 0.0.0 --local --generate-tests
```

## Library imports

```ts
import { AgentThread } from '@truefoundry/utils-core/core';
import { Sessions } from '@truefoundry/utils-core/agent-session';
```

Or namespaced:

```ts
import { core, agentSession } from '@truefoundry/utils-core';
```

Workspace-only `development` exports are removed from the published package. Its staged `dist/package.json` remains CommonJS so `require()` uses `.js`, while ESM consumers use `.mjs`. After switching from `@truefoundry/utils` to `@truefoundry/utils-core`, consumers such as `tfy-llm-gateway` keep the same deep-import and CJS/ESM layout. Consumer compatibility is checked against a packed artifact, including root, barrel, deep skill imports, and both CJS and ESM loading.

Server-only deps (`hono`, `@hono/node-server`, `@hono/swagger-ui`, `yaml`, `better-sqlite3`, `pg`, `redis`) live in `packages/server` and never reach library consumers.
