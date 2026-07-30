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

```bash
# terminal 1 — harness API (default :8790)
pnpm --filter @truefoundry/server dev

# terminal 2 — Vite UI (:3000) with path proxy
pnpm --filter frontend dev
# or: pnpm dev:frontend
```

Open `http://localhost:3000`.

### Session paths

The gateway SDK is generated against the gateway, where session routes sit under `/v1/agents` and draft
sessions are a separate resource. The harness serves one `/v1/sessions` surface, so
[`src/harnessFetch.ts`](src/harnessFetch.ts) rewrites requests on their way out and is handed to both
clients as their `fetch`:

| SDK request                  | Harness route   |
| ---------------------------- | --------------- |
| `/v1/agents/draft-sessions*` | `/v1/sessions*` |
| `/v1/agents/sessions*`       | `/v1/sessions*` |

Vite's dev proxy forwards `/v1/*` to `localhost:8790` untouched; nothing else rewrites paths.

## Production

There is no frontend image. `pnpm build` writes `dist/` plus `.br`/`.gz` siblings
(`vite-plugin-compression2`), and the server serves it from `FRONTEND_DIR`, so the UI and API share one
origin and one container. See the root README.

The Monaco workers land in `dist/monacoeditorwork/` outside Vite's asset pipeline, so the plugin cannot
precompress them; the server gzips those on the fly instead.

```bash
docker compose up --build   # UI + API on http://localhost:8790
```

## Catalogs (model + MCP)

The SDK has no catalog client. On boot the app:

1. `GET /v1/models` → seeds `defaultAgentSpec.model.name`
2. Renders custom `ComposerRightSection` controls that `fetch` models/MCP and call `updateAgentSpec`

Skills: catalog UI lists `GET /v1/skills` (empty state when none). Selection is local-only — session admission still rejects `agent_spec.skills`.

## Gaps

| Item                                  | Status                                   |
| ------------------------------------- | ---------------------------------------- |
| Subscribe turn SSE                    | Deferred (route defined, not registered) |
| Skills                                | Deferred                                 |
| Attachments / sandbox download        | Off                                      |
| Session `type` / `created_by_subject` | Soft — not required for draft FE         |
| `turn.created.created_by`             | Soft — stream adopt tolerates missing    |

## Scripts

| Script           | Action                        |
| ---------------- | ----------------------------- |
| `pnpm dev`       | Vite dev server               |
| `pnpm build`     | Typecheck + production bundle |
| `pnpm typecheck` | `tsc --noEmit`                |
