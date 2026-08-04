# frontend

Private draft-only agent chat UI for the harness server. **Not published to npm** (`"private": true`).

Built on:

```
truefoundry-gateway-sdk (AgentSessionClient + PrivateAgentSessionClient)
  → @truefoundry/assistant-ui-runtime (useTrueFoundryAgentRuntime, mode: draft)
    → @assistant-ui/react
      → @truefoundry/agent-ui-sdk (Thread, ThreadListContainer)
```

No login (`auth: false`). Skills are not wired in v1.

## Local development

For the full host workflow (Compose Postgres/Redis, then API + Vite), see the root
[`README.md`](../../README.md#development).

```bash
pnpm dev            # API on :8790 and Vite on :3000 together (after `pnpm dev:infra`)
pnpm dev:frontend   # or Vite alone, against an API that is already up
```

Open `http://localhost:3000`: Vite serves the UI from source (edits hot-reload, no rebuild or server
restart) and proxies `/api/*` to `VITE_SERVER_URL`, default `http://localhost:8790`. `FRONTEND_PORT`
moves Vite off `:3000`. That proxy is the only dev-specific wiring and lives entirely in
[`vite.config.ts`](vite.config.ts); the server needs no build to answer the API.

### Session paths

The gateway SDK's session routes sit under `/v1/agents`, with draft sessions as a separate resource. The
harness YAML-backed surface is `/api/v1/legacy/sessions`, so [`src/harnessFetch.ts`](src/harnessFetch.ts)
rewrites requests on their way out and is handed to both clients as their `fetch`:

| SDK request                  | Harness route              |
| ---------------------------- | -------------------------- |
| `/v1/agents/draft-sessions*` | `/api/v1/legacy/sessions*` |
| `/v1/agents/sessions*`       | `/api/v1/legacy/sessions*` |

It runs in the browser, so the mapping is identical in dev and production; the dev proxy just forwards.

## Production

There is no frontend image. `pnpm build` writes `dist/` plus `.br`/`.gz` siblings
(`vite-plugin-compression2`) that the server serves from `FRONTEND_DIR`, sharing one origin with the API.
The Monaco workers land outside Vite's asset pipeline and cannot be precompressed, so the server gzips
those on the fly.

```bash
docker compose up --build   # UI + API on http://localhost:8791
```

## Catalogs (model + MCP)

The SDK has no catalog client. On boot the app:

1. `GET /api/v1/legacy/models` → seeds `defaultAgentSpec.model.name`
2. Renders custom `ComposerRightSection` controls that `fetch` models/MCP and call `updateAgentSpec`

Skills: catalog UI lists `GET /api/v1/legacy/skills` (empty state when none). Selection is local-only — session admission still rejects `agent_spec.skills`.

## Gaps

| Item                                  | Status                                        |
| ------------------------------------- | --------------------------------------------- |
| Subscribe turn SSE                    | Deferred (route defined, not registered)      |
| Skills                                | Deferred                                      |
| Attachments / sandbox download        | On (adapter wired; sandbox download deferred) |
| Session `type` / `created_by_subject` | Soft — not required for draft FE              |
| `turn.created.created_by`             | Soft — stream adopt tolerates missing         |

## Scripts

| Script           | Action                        |
| ---------------- | ----------------------------- |
| `pnpm dev`       | Vite dev server               |
| `pnpm build`     | Typecheck + production bundle |
| `pnpm typecheck` | `tsc --noEmit`                |
