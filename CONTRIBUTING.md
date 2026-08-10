# Contributing to TrueForge

Thanks for your interest in contributing! This document covers how to set up a development environment, run the test suites, and get a pull request merged.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md). By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

## Ways to contribute

- **Report bugs** — open an issue with steps to reproduce, expected vs actual behavior, and your environment.
- **Suggest features** — open an issue describing the problem you're trying to solve, not only the solution.
- **Improve docs** — typo fixes and clarifications are always welcome.
- **Fix bugs / build features** — for anything non-trivial, please open an issue first so we can discuss the approach before you invest time.

For security vulnerabilities, do **not** open a public issue — see [SECURITY.md](SECURITY.md).

## Prerequisites

- **Node.js 22.13+** (see [`.nvmrc`](.nvmrc))
- **pnpm** (version pinned via `packageManager` in [`package.json`](package.json); `corepack enable` handles it)
- **Docker** — only needed for Postgres/Redis dev infra, the smoke test, and SDK generation

## Repository layout

This is a pnpm workspace:

| Workspace package           | Published as                  | Path                                                     | What it is                                   |
| --------------------------- | ----------------------------- | -------------------------------------------------------- | -------------------------------------------- |
| `@truefoundry/utils`        | `@truefoundry/trueforge`      | [`packages/server`](packages/server)                     | Agent server + bundled UI                    |
| `@truefoundry/utils-core`   | `@truefoundry/trueforge-core` | [`packages/harness`](packages/harness)                   | Library: agent core, sessions, and streaming |
| `@truefoundry/trueforge-ui` | `@truefoundry/trueforge-ui`   | [`packages/trueforge-ui-sdk`](packages/trueforge-ui-sdk) | Embeddable agent chat UI SDK                 |
| `trueforge`                 | `trueforge`                   | [`packages/sdk`](packages/sdk)                           | Generated TypeScript API client              |
| `frontend`                  | —                             | [`packages/frontend`](packages/frontend)                 | Chat UI app (bundled into the server)        |

> Note: some workspace package and folder names (`utils`, `harness`) predate the public release names and will be renamed.

## Setup

```bash
pnpm install
cp packages/server/.env.example packages/server/.env
```

## Running from source

There are two dev topologies. Both serve the UI on [http://localhost:3000](http://localhost:3000) (Vite, with live reload, proxying `/api/*`) and the API on [http://localhost:8790](http://localhost:8790).

### Standalone (zero infra)

SQLite only — good for most day-to-day development:

```bash
pnpm standalone:dev
```

### Multi-replica (Postgres + Redis)

Use this when working on anything involving Postgres storage or Redis peering (cross-replica turn cancels and stream handoff).

Terminal 1 — start Postgres (`:5432`) and Redis (`:6379`):

```bash
pnpm dev:infra
```

Terminal 2:

```bash
pnpm dev
```

|           | Standalone                             | Multi-replica                                   |
| --------- | -------------------------------------- | ----------------------------------------------- |
| Process   | One server                             | One or more replicas with Redis peering         |
| Database  | SQLite                                 | Postgres                                        |
| Infra     | None                                   | Postgres + Redis (`pnpm dev:infra` or your own) |
| Dev       | `pnpm standalone:dev`                  | `pnpm dev` (after infra)                        |
| Prod-like | `pnpm build` → `pnpm standalone:start` | `pnpm build` → `pnpm start`                     |

Local server scripts resolve `@truefoundry/utils-core` from source, so you do not need a utils-core `dist/` build for `pnpm dev` / `standalone:dev`. Frontend scripts build `@truefoundry/trueforge-ui` `dist/` before Vite starts (workspace package exports point at `dist/`).

### How the UI is served

Dev and production-like runs use different process topologies. Standalone vs multi-replica only changes storage/peering (`STANDALONE`); it does not change how the UI is served.

**Development** — `pnpm standalone:dev` / `pnpm dev` run two processes in parallel: Vite (UI, with live reload) and the Hono API. The browser talks to Vite; Vite proxies `/api/*` to Hono.

```
  browser                     Vite (:3000)                   Hono (:8790)
     │                             │                              │
     │  GET /  (UI)                │                              │
     │────────────────────────────>│                              │
     │                             │                              │
     │  /api/*                     │  proxy                       │
     │────────────────────────────>│─────────────────────────────>│
```

**Production-like** — after `pnpm build`, `pnpm standalone:start` / `pnpm start` run a single Hono process. It serves the built frontend bundle for non-API routes and handles `/api/*` itself. The Docker container works the same way: one process, one origin.

```
  browser                                    Hono (:8790)
     │                                            │
     │  GET /  (static UI from dist/_frontend)    │
     │───────────────────────────────────────────>│
     │                                            │
     │  /api/*                                    │
     │───────────────────────────────────────────>│
```

On one origin (start / Docker): `/api/*` (including OpenAPI) and `/healthz` are the API; everything else is the UI. The server prefers a packaged `dist/_frontend`, then `packages/frontend/dist`. With no UI build present it serves the API only (normal for Vite-backed `pnpm dev`).

### Configuration

See [`packages/server/.env.example`](packages/server/.env.example) for every env var. Useful dev overrides:

- `PORT` — API port (default `8790`)
- `FRONTEND_PORT` — Vite UI port in dev (default `3000`); see [`packages/frontend/README.md`](packages/frontend/README.md)
- `VITE_SERVER_URL` — point the Vite proxy at a different API
- `FRONTEND_DIR` — directory of a built UI for the server to serve
- `SQLITE_PATH` — SQLite file location in standalone mode
- `REDIS_URL` / `POSTGRES_*` — used when `STANDALONE=false`

### Migrations

Migrations run on server startup. To run Postgres migrations without starting HTTP:

```bash
pnpm --filter @truefoundry/utils migrate
```

That script sets `STANDALONE=false` and uses `POSTGRES_*` from `packages/server/.env`. It will not run in standalone mode (SQLite migrations happen on boot instead).

## Workspace scripts

Workspace tasks go through `package.json` scripts — if a repeatable workflow is missing, add a script rather than documenting an ad hoc command.

| Script                                               | Purpose                                               |
| ---------------------------------------------------- | ----------------------------------------------------- |
| `pnpm standalone:dev` / `pnpm dev`                   | Local UI + API (see modes above)                      |
| `pnpm standalone:dev:no-watch` / `pnpm dev:no-watch` | Same, but the server does not restart on file changes |
| `pnpm dev:server:ui`                                 | Packed UI + watched API (no Vite)                     |
| `pnpm build`                                         | Build all packages                                    |
| `pnpm test` / `pnpm typecheck`                       | Workspace checks                                      |
| `pnpm lint` / `pnpm format`                          | ESLint (with fixes) / Prettier                        |
| `pnpm smoke` / `pnpm smoke:down`                     | Full Docker Compose stack + health check              |
| `pnpm chart:lint` / `pnpm chart:template`            | Validate the Helm chart                               |
| `pnpm clean` / `pnpm clean:all`                      | Remove build outputs (+ `node_modules` for `:all`)    |

## Testing

```bash
pnpm test         # unit tests across all packages
pnpm typecheck    # TypeScript across all packages
pnpm lint         # ESLint
pnpm format:check # Prettier
```

### Store contract tests

Storage-layer changes should pass both store suites (CI runs them when store paths change):

```bash
pnpm --dir packages/server test:store:sqlite
pnpm test:store:local   # Postgres suite against local infra
```

### Smoke test (Docker)

Full stack in containers — the built server image serves API + UI, in multi-replica mode (`STANDALONE=false`):

```bash
pnpm smoke       # build, wait for healthy services, check /healthz and UI
pnpm smoke:down
```

Open [http://localhost:8791](http://localhost:8791). Credentials come from `packages/server/.env`. Host ports are offset from local dev so they do not collide: Postgres `:5433`, Redis `:6380`, app `:8791`.

## Generated code — do not edit by hand

- [`packages/sdk`](packages/sdk) and [`.github/fern/openapi/openapi.json`](.github/fern/openapi/openapi.json) are generated by [Fern](https://buildwithfern.com) and committed. Edit route handlers under `packages/server/src/routes/` instead; CI regenerates the outputs. To regenerate locally (Docker required): `pnpm sdk:generate`.
- Catalog YAML files under `packages/server/src/catalog/` are inlined at build time by `build:gen` scripts.

## Server entry points

| File           | Used by                                       | Role                                        |
| -------------- | --------------------------------------------- | ------------------------------------------- |
| `dist/main.js` | Docker, `pnpm start`, `pnpm standalone:start` | Env-only server boot                        |
| `dist/cli.js`  | `npx @truefoundry/trueforge`                  | CLI (`--help`, `--port`), then loads `main` |

## Coding conventions

The repository-wide rules live in [`AGENTS.md`](AGENTS.md) (some packages have their own nested `AGENTS.md`). Highlights:

- No type-assertion escapes (`as T`, non-null `!`) to silence errors — fix the types.
- Wrap-and-rethrow must preserve the original error via `{ cause }`.
- Zod-backed types are derived with `z.infer<typeof Schema>`; don't duplicate schemas as interfaces.
- Static `import` / `import type` only — no `require()`.
- Tests live under a top-level `test`/`tests` directory mirroring `src`, never inline.
- Wire shapes (HTTP/OpenAPI) and database identifiers use `snake_case`.
- Server env reads go through `packages/server/src/config.ts`, never `process.env` directly.
- Remove dead code in the same change that makes it dead.

Prettier and ESLint run as pre-commit hooks via husky + lint-staged.

## Pull requests

1. Fork (or branch) and create a topic branch: `git checkout -b my-fix`.
2. Make your change, with tests where it makes sense.
3. Make sure `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint:ci`, and `pnpm format:check` pass — CI runs exactly these.
4. Keep PRs focused and reasonably small; describe **what** changed and **why** in the description.
5. Open the PR. A maintainer will review it; squash-merge is the norm.

## Releases

Maintainers: see [RELEASING.md](RELEASING.md) for the npm, container image, and Helm chart release flows.
