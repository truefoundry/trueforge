# TrueFoundry harness workspace

pnpm workspace with:

| Package                   | Path                                     | Role                                                  |
| ------------------------- | ---------------------------------------- | ----------------------------------------------------- |
| `@truefoundry/utils-core` | [`packages/harness`](packages/harness)   | Published library (`core` + `agent-session`)          |
| `@truefoundry/utils`      | [`packages/server`](packages/server)     | Published app + CLI (`npx @truefoundry/utils`)        |
| `frontend`                | [`packages/frontend`](packages/frontend) | Private draft-only agent chat UI (bundled into utils) |

## Choose a mode

|            | **Standalone**                         | **Non-standalone**                              |
| ---------- | -------------------------------------- | ----------------------------------------------- |
| Process    | One server process                     | One or more replicas with Redis peering         |
| Default DB | SQLite                                 | Postgres                                        |
| Infra      | None                                   | Postgres + Redis (`pnpm dev:infra` or your own) |
| Dev        | `pnpm standalone:dev`                  | `pnpm dev` (after infra)                        |
| Prod-like  | `pnpm build` → `pnpm standalone:start` | `pnpm build` → `pnpm start`                     |

Root scripts set `STANDALONE` and `NODE_ENV` explicitly (they win over `.env`). Persistence can be overridden with `DATABASE_BACKEND=postgres|sqlite` independently of topology.

Configure model providers (and MCP / skills / sandbox) in the UI under Settings, or via the settings APIs — discovery presets come from the `*/catalog` endpoints.

## One-time setup

```bash
pnpm install
cp packages/server/.env.example packages/server/.env
```

You usually do not set `STANDALONE` in `.env`; use the root scripts below. Leave `POSTGRES_*` / `REDIS_URL` as in the example for local non-standalone (Compose and config defaults match).

## Standalone quickstart

Zero-env: SQLite, no Redis/Postgres.

```bash
pnpm standalone:dev
```

Open `http://localhost:3000` (Vite proxies `/api/*` to the API on `:8790`).

Prod-like (packed UI served by the server, no Vite):

```bash
pnpm build
pnpm standalone:start
```

Open `http://localhost:8790`. Same path as published `npx @truefoundry/utils` (CLI entry is `dist/cli.js`; see below).

## Non-standalone quickstart

Postgres + Redis required.

Terminal 1:

```bash
pnpm dev:infra   # Postgres :5432 and Redis :6379; Ctrl+C stops them
```

Terminal 2:

```bash
pnpm dev         # API :8790 + Vite :3000; STANDALONE=false
```

Open `http://localhost:3000`.

Prod-like:

```bash
pnpm build
pnpm start       # node dist/main.js, STANDALONE=false; needs infra still running
```

Open `http://localhost:8790` (UI from `packages/server/dist/_frontend`).

## Optional scripts

| Script                                               | Purpose                                                                                        |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `pnpm dev:no-watch` / `pnpm standalone:dev:no-watch` | Same as `dev` / `standalone:dev` but server does not restart on file changes (Vite still runs) |
| `pnpm dev:server:ui`                                 | Build FE, copy to `dist/_frontend`, watched API, no Vite — packed UI + hot server              |
| `pnpm smoke` / `pnpm smoke:down`                     | Full Compose stack (API+UI image on `:8791`)                                                   |
| `pnpm clean` / `pnpm clean:all`                      | Build outputs (+ `node_modules` for `:all`)                                                    |

Migrations run on server startup. Postgres-only without HTTP:

```bash
pnpm --filter @truefoundry/utils migrate
```

Workspace checks:

```bash
pnpm build
pnpm test
pnpm typecheck
```

`FRONTEND_PORT` moves Vite off `:3000`, `VITE_SERVER_URL` points it at another API. See [`packages/frontend/README.md`](packages/frontend/README.md).

Local server scripts resolve `@truefoundry/utils-core` from source (`exports.development`), so a utils-core `dist/` build is not required for `pnpm dev` / `standalone:dev`. Root watched modes regenerate sandbox helpers and catalog YAML into TypeScript; neither path builds `dist`.

## Serving the UI from the server

Deployments are one process on one origin: `/api/*` (including `/api/v1/docs` and `/api/v1/openapi.json`) and `/healthz` are the API; everything else resolves to the UI.

Frontend resolution prefers packaged `dist/_frontend` (npm tarball / Docker / `pnpm build` / `dev:server:ui` copy), then monorepo `packages/frontend/dist`. Override with `FRONTEND_DIR` if needed. With no build at that path the server logs a warning and serves the API only (what Vite-backed `dev` needs).

### `cli.js` vs `main.js`

| Entry          | Used by                                         | Role                                             |
| -------------- | ----------------------------------------------- | ------------------------------------------------ |
| `dist/main.js` | Docker, `pnpm start`, `pnpm standalone:start`   | Env-only server boot                             |
| `dist/cli.js`  | `npx @truefoundry/utils` (`package.json` `bin`) | Shebang, `--help`, `--port`, then imports `main` |

`--port` must be applied before config loads, which is why the published bin is not `main.js` alone.

## Docker Compose smoke test

Full stack in containers — built server image serves API + UI (no Vite). Smoke forces `STANDALONE=false` (Postgres + Redis):

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
