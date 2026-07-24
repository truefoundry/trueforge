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

### Vite proxy map

| Browser                                          | Upstream (`localhost:8790`) |
| ------------------------------------------------ | --------------------------- |
| `/v1/agents/draft-sessions*`                     | `/v1/sessions*`             |
| `/v1/agents/sessions*`                           | `/v1/sessions*`             |
| `/v1/models*`, `/v1/mcp-servers*`, `/v1/skills*` | passthrough                 |

## Docker Compose

Requires `packages/server/.env` and `packages/server/registry/` (see server docs).

```bash
docker compose up --build
```

- UI: `http://localhost:3000` (`FRONTEND_PORT`)
- API: `http://localhost:8790` (direct) or same-origin `/v1/...` via Caddy in the frontend container

Caddy uses the same path rewrite as Vite and disables buffering for SSE.

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
