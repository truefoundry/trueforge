# Contributing to TrueForge

Thanks for your interest in contributing! This document covers how to set up a development environment, run the test suites, and get a pull request merged.

By participating you agree to follow our [Code of Conduct](CODE_OF_CONDUCT.md). By contributing you agree that your contributions are licensed under the [MIT License](LICENSE).

## Ways to contribute

> [!Important]
> Please only submit pull requests for an issue when you have received approval from a maintainer.
> While we value good intentions, we require approvals for community code contributions to ensure we use everyone's time effectively.

- **Report bugs** - open an issue with steps to reproduce, expected vs actual behavior, and your environment.
- **Improve docs** - typo fixes and clarifications are always welcome.
- **Fix bugs / build features** - for anything non-trivial, please open an issue first so we can discuss the approach before you invest time

For security vulnerabilities, do **not** open a public issue - see [SECURITY.md](SECURITY.md).

### Why we require approvals for community code contributions

> [!Tip]
> Every new issue by default is labelled with [needs-maintainer-attention](https://github.com/truefoundry/trueforge/issues?q=is%3Aissue%20state%3Aopen%20label%3Aneeds-maintainer-attention). A maintainer will review the issue and discuss the next steps. Please don't remove this label while creating the issue.

Effective changes to TrueForge require architectural context, an understanding of system-level constraints, and visibility into the project's roadmap. Community pull requests often focus on issues that are lower priority, affect a small number of users, or need substantial changes to fit the broader system. Reviewing and iterating on those changes can take more time than implementing a fix directly, diverting attention from higher-priority work.

Community expertise is most valuable when shared through detailed bug reports, reproduction steps, logs, root-cause analysis, and design discussions in issues. Understanding the problem, identifying the right solution, and prioritizing the work are typically the hard parts; implementation is comparatively straightforward with coding assistants.

For these reasons, we focus community contributions on issue reports, analysis, and feedback, over larger code changes.

> [!Note]
> If you would still like to contribute code, we keep a dedicated set of issues marked as [help-wanted](https://github.com/truefoundry/trueforge/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22help%20wanted%22) that are well scoped.

### Issue labels

| Label                                                                                                                                          | Meaning                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| [help-wanted](https://github.com/truefoundry/trueforge/issues?q=is%3Aissue%20state%3Aopen%20label%3A%22help%20wanted%22)                       | Well-scoped issue where community contributions are welcome.             |
| [needs-maintainer-attention](https://github.com/truefoundry/trueforge/issues?q=is%3Aissue%20state%3Aopen%20label%3Aneeds-maintainer-attention) | Issue needs discussion with maintainers before implementation can start. |

### Reporting bugs

Before opening a new issue, search the issue tracker to see whether the problem has already been reported. If it has, add any new information to the existing issue.

When reporting a bug, include as much relevant detail as possible:

- Clear, detailed steps to reproduce the problem.
- Expected and actual behavior.
- Your TrueForge version, operating system, and other relevant environment details.
- Logs, error messages, or other diagnostic information, with sensitive information removed.
- Root-cause analysis, technical observations, or potential approaches to a fix, if available.

### Requesting features

Open a feature request in the issue tracker, or upvote an existing request that describes the same need. Explain your use case, the behavior you would like, and why it would improve your workflow.

## Prerequisites

- **Node.js 22.14+** (see [`.nvmrc`](.nvmrc); pnpm 11.16 needs 22.13+, and `better-sqlite3` v13 needs Node-API 10)
- **pnpm** (version pinned via `packageManager` in [`package.json`](package.json); `corepack enable` handles it)
- **Docker** - only needed for Postgres/Redis dev infra, the smoke test, and local SDK generation (maintainers). Fork contributors do not generate the SDK.

## Repository layout

This is a pnpm workspace:

| Workspace package             | Published as                  | Path                                                 | What it is                                   |
| ----------------------------- | ----------------------------- | ---------------------------------------------------- | -------------------------------------------- |
| `@truefoundry/trueforge`      | `@truefoundry/trueforge`      | [`packages/trueforge`](packages/trueforge)           | Agent server + bundled UI                    |
| `@truefoundry/trueforge-core` | `@truefoundry/trueforge-core` | [`packages/trueforge-core`](packages/trueforge-core) | Library: agent core, sessions, and streaming |
| `@truefoundry/trueforge-ui`   | `@truefoundry/trueforge-ui`   | [`packages/trueforge-ui`](packages/trueforge-ui)     | Embeddable agent chat UI SDK                 |
| `@truefoundry/trueforge-sdk`  | `@truefoundry/trueforge-sdk`  | [`packages/trueforge-sdk`](packages/trueforge-sdk)   | Generated TypeScript API client              |
| `frontend`                    | -                             | [`packages/frontend`](packages/frontend)             | Chat UI app (bundled into the server)        |

## Setup

```bash
pnpm install
cp packages/trueforge/.env.example packages/trueforge/.env
```

## Running from source

There are two dev topologies. Both serve the UI on [http://localhost:3000](http://localhost:3000) (Vite, with live reload, proxying `/api/*`) and the API on [http://localhost:8790](http://localhost:8790).

### Standalone (zero infra)

SQLite only - good for most day-to-day development. Standalone mode is intended for local use; it is not a production-safe topology (no login by default, local SQLite). Please do not expose it beyond localhost.

```bash
pnpm standalone:dev
```

### Multi-replica (Postgres + Redis)

Use this when working on anything involving Postgres storage or Redis peering (cross-replica turn cancels and stream handoff).

Terminal 1 - start Postgres (`:5432`) and Redis (`:6379`):

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

Local server scripts resolve `@truefoundry/trueforge-core` from source, so you do not need a trueforge-core `dist/` build for `pnpm dev` / `standalone:dev`. Frontend scripts build `@truefoundry/trueforge-ui` `dist/` before Vite starts (workspace package exports point at `dist/`).

### How the UI is served

Dev and production-like runs use different process topologies. Standalone vs multi-replica only changes storage/peering (`STANDALONE`); it does not change how the UI is served.

**Development** - `pnpm standalone:dev` / `pnpm dev` run two processes in parallel: Vite (UI, with live reload) and the Hono API. The browser talks to Vite; Vite proxies `/api/*` to Hono.

```
  browser                     Vite (:3000)                   Hono (:8790)
     │                             │                              │
     │  GET /  (UI)                │                              │
     │────────────────────────────>│                              │
     │                             │                              │
     │  /api/*                     │  proxy                       │
     │────────────────────────────>│─────────────────────────────>│
```

**Production-like** - after `pnpm build`, `pnpm standalone:start` / `pnpm start` run a single Hono process. It serves the built frontend bundle for non-API routes and handles `/api/*` itself. The Docker container works the same way: one process, one origin.

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

See [`packages/trueforge/.env.example`](packages/trueforge/.env.example) for every env var. Useful dev overrides:

- `PORT` - API port (default `8790`)
- `FRONTEND_PORT` - Vite UI port in dev (default `3000`); see [`packages/frontend/README.md`](packages/frontend/README.md)
- `VITE_SERVER_URL` - point the Vite proxy at a different API
- `PUBLIC_BASE_URL` - public origin for MCP OAuth / OIDC callbacks. Required for `pnpm standalone:dev` / `pnpm dev` and for distributed mode (e.g. `http://localhost:3000` for Vite). Non-development standalone falls back to `http://localhost:$PORT`.
- `FRONTEND_DIR` - directory of a built UI for the server to serve
- `SQLITE_PATH` - SQLite file location in standalone mode
- `REDIS_URL` / `POSTGRES_*` - used when `STANDALONE=false`

### Migrations

Migrations run on server startup. To run Postgres migrations without starting HTTP:

```bash
pnpm --filter @truefoundry/trueforge migrate
```

That script sets `STANDALONE=false` and uses `POSTGRES_*` from `packages/trueforge/.env`. It will not run in standalone mode (SQLite migrations happen on boot instead).

## Workspace scripts

Workspace tasks go through `package.json` scripts - if a repeatable workflow is missing, add a script rather than documenting an ad hoc command.

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
pnpm --dir packages/trueforge test:store:sqlite
pnpm test:store:local   # Postgres suite against local infra
```

### Smoke test (Docker)

Full stack in containers - the built server image serves API + UI, in multi-replica mode (`STANDALONE=false`):

```bash
pnpm smoke       # build, wait for healthy services, check /healthz and UI
pnpm smoke:down
```

Open [http://localhost:8791](http://localhost:8791). Credentials come from `packages/trueforge/.env`. Host ports are offset from local dev so they do not collide: Postgres `:5433`, Redis `:6380`, app `:8791`.

## Generated code - do not edit by hand

- [`packages/trueforge-sdk`](packages/trueforge-sdk), [`.github/fern/openapi/openapi.json`](.github/fern/openapi/openapi.json), and [`docs/openapi.json`](docs/openapi.json) are generated and committed. Edit route handlers under `packages/trueforge/src/routes/` instead; CI regenerates the outputs. To regenerate locally (Docker required): `pnpm sdk:generate`.
- Catalog YAML files under `packages/trueforge/catalog/` are inlined at build time by `build:gen` scripts.

## Server entry points

| File           | Used by                                       | Role                                        |
| -------------- | --------------------------------------------- | ------------------------------------------- |
| `dist/main.js` | Docker, `pnpm start`, `pnpm standalone:start` | Env-only server boot                        |
| `dist/cli.js`  | `npx @truefoundry/trueforge`                  | CLI (`--help`, `--port`), then loads `main` |

## Coding conventions

The repository-wide rules live in [`AGENTS.md`](AGENTS.md) (some packages have their own nested `AGENTS.md`). Highlights:

- No type-assertion escapes (`as T`, non-null `!`) to silence errors - fix the types.
- Wrap-and-rethrow must preserve the original error via `{ cause }`.
- Zod-backed types are derived with `z.infer<typeof Schema>`; don't duplicate schemas as interfaces.
- Static `import` / `import type` only - no `require()`.
- Tests live under a top-level `test`/`tests` directory mirroring `src`, never inline.
- Wire shapes (HTTP/OpenAPI) and database identifiers use `snake_case`.
- Server env reads go through `packages/trueforge/src/config.ts`, never `process.env` directly.
- Remove dead code in the same change that makes it dead.

Prettier and ESLint run as pre-commit hooks via husky + lint-staged.

## Pull requests

1. Fork (or branch) and create a topic branch: `git checkout -b my-fix`.
2. Make your change, with tests where it makes sense. Do not commit generated OpenAPI/SDK output (forks: source only; `main` regenerates after merge).
3. Make sure `pnpm build`, `pnpm test`, `pnpm typecheck`, `pnpm lint:ci`, and `pnpm format:check` pass - CI runs exactly these.
4. Keep PRs focused and reasonably small; describe **what** changed and **why** in the description.
5. Open the PR. A maintainer will review it; squash-merge is the norm.
6. **Please avoid rebasing or force-pushing once a maintainer has started reviewing.** It can make iterative reviewing harder. To update your branch, merge `main` instead. We squash-merge at the end, so messy in-PR history is fine.

## Releases

Maintainers: see [RELEASING.md](RELEASING.md) for the npm, container image, and Helm chart release flows.
