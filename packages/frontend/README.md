# frontend

Private draft-only agent chat UI for the harness server. **Not published to npm** (`"private": true`).

Built on:

```
trueforge (local Harness SDK)
  → Harness AgentChatServer adapter
    → createTrueFoundryServer (chat port + catalog callbacks)
      → @truefoundry/trueforge-ui (TrueforgeUI, layout="sidebar")
```

The SDK owns the shell: sidebar, thread list, composer, model and connector pickers, and the
runtime wiring. [`App.tsx`](src/App.tsx) only seeds `defaultAgentSpec` from the Harness catalogs
and renders the API error card.

No login is required.

## Local development

For the full host workflow (standalone or non-standalone), see the root
[`README.md`](../../README.md).

```bash
pnpm standalone:dev   # zero-env: SQLite, Vite :3000 + API :8790
# or:
pnpm dev:infra        # then in another terminal:
pnpm dev              # Postgres + Redis, Vite :3000 + API :8790
```

Open `http://localhost:3000`: Vite serves the UI from source (edits hot-reload, no rebuild or server
restart) and proxies `/api/*` to `VITE_SERVER_URL`, default `http://localhost:8790`. `FRONTEND_PORT`
moves Vite off `:3000`. Vite uses `strictPort` — if that port is already bound, dev exits instead of
picking another. That proxy is the only dev-specific wiring and lives entirely in
[`vite.config.ts`](vite.config.ts); the server needs no build to answer the API.

### Server adapter

[`src/harnessServer.ts`](src/harnessServer.ts) wraps the Harness SDK with the flat `AgentChatServer`
contract. It maps mutable session DTOs, pagination, turns, event history, cancellation, and SSE
metadata while keeping the browser pointed directly at `/api/v1/sessions`.

`trueforge-ui` still declares the pre-0.1.6 contract (mounts carry `id`, list results are
`PageResult`, absent values are `undefined`) while the runtime it delegates to reads `nextPageToken`
and tolerates `null`. The adapter emits values valid under both — derived mount ids, pages carrying
`nextPageToken` _and_ `hasNextPage()`, `null` normalised to absent — so no layer needs a cast.

The local SDK is linked as `trueforge`. Frontend dev, typecheck, test, and build scripts build it first,
so clean checkouts do not rely on committed `dist/` output.

## Production

There is no frontend image. `pnpm build` writes `dist/` plus `.br`/`.gz` siblings
(`vite-plugin-compression2`) that the server serves from `FRONTEND_DIR`, sharing one origin with the API.
The Monaco workers land outside Vite's asset pipeline and cannot be precompressed, so the server gzips
those on the fly.

```bash
docker compose up --build   # UI + API on http://localhost:8791
```

## Composer lists + builder (model + MCP + skills)

[`src/composerLists.ts`](src/composerLists.ts) calls the DB-backed list endpoints via `trueforge`.
[`src/harnessBuilderServer.ts`](src/harnessBuilderServer.ts) maps those into `AgentBuilderServer`
callbacks; `App.tsx` spreads them into `createTrueFoundryServer` (settings CRUD lives in `*Catalog.ts`):

| Callback       | Source                                                            |
| -------------- | ----------------------------------------------------------------- |
| `getModels`    | `GET /api/v1/models` (also seeds `defaultAgentSpec.model`)        |
| `getMcp`       | `GET /api/v1/mcp-servers`                                         |
| `getSkills`    | `GET /api/v1/skills` when `GET /api/v1/capabilities` has skill on |
| `searchAgents` | Empty — Harness has no agent registry                             |
| `saveAgent`    | Rejects — sessions are draft-only                                 |

The SDK's picker round-trips a skill as `{ id, name }`. Harness persists name refs only
(`{ name }`), so `harnessServer` derives `id` from `name` on read and strips `id` on write.
Skills stay empty in the picker when the skill capability is off (no sandbox provider configured).

The Agents Library button still renders (the SDK shows it whenever `agentName` is omitted) and
opens an empty list; `AgentsLibraryButton` is not part of the publicly typed `AtomSlots`, so it
cannot be overridden away without a cast.

## Gaps

| Item                                  | Status                                   |
| ------------------------------------- | ---------------------------------------- |
| Subscribe turn SSE                    | Deferred (route defined, not registered) |
| Attachments / sandbox download        | Off                                      |
| Session `type` / `created_by_subject` | Soft — not required for draft FE         |
| `turn.created.created_by`             | Soft — stream adopt tolerates missing    |

## Scripts

| Script           | Action                        |
| ---------------- | ----------------------------- |
| `pnpm dev`       | Vite dev server               |
| `pnpm build`     | Typecheck + production bundle |
| `pnpm typecheck` | `tsc --noEmit`                |
