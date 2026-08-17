# frontend

Private agent chat UI for the harness server (registry + inline sessions). **Not published to npm** (`"private": true`).

Built on:

```
@truefoundry/trueforge-sdk  (HTTP client; cookie/OIDC via host fetch)
  → @truefoundry/trueforge-ui
       server={{ type: 'trueforge', baseUrl, fetch }}
         → plugins/trueforge-agent-server-adapter
              (chat + builder + settings catalogs)
           → TrueForgeUI (layout="sidebar")
```

[`App.tsx`](src/App.tsx) owns product chrome only:

- auth gate / welcome / logout (`authFetch`, `authSession`)
- boot: first model → `defaultAgentSpec`, `initialSettingsOpen`
- `<TrueForgeUI server={{ type: 'trueforge', baseUrl: '/', fetch: authAwareFetch }} />`

Chat, agent library, and settings catalogs are composed inside the UI SDK plugin —
the host does **not** call `createTrueFoundryServer` or maintain harness adapters.

## Local development

For the full host workflow (standalone or non-standalone), see the root
[`README.md`](../../README.md).

```bash
pnpm standalone:dev   # zero-env: SQLite, Vite :3000 + API :8790
# or:
pnpm dev:infra        # then in another terminal:
pnpm dev              # Postgres + Redis, Vite :3000 + API :8790
```

Open `http://localhost:3000`: Vite serves the UI from source (edits hot-reload) and
proxies `/api/*` to `VITE_SERVER_URL` (default `http://localhost:8790`).
`FRONTEND_PORT` moves Vite off `:3000`. Vite uses `strictPort` — if that port is
already bound, dev exits instead of picking another. Proxy wiring lives in
[`vite.config.ts`](vite.config.ts).

`predev` / `prebuild` / `pretypecheck` build `@truefoundry/trueforge-sdk` and
`@truefoundry/trueforge-ui` first so clean checkouts do not rely on stale `dist/`.

### Auth

[`authFetch.ts`](src/authFetch.ts) wraps `fetch` and redirects to OIDC login on HTTP 401.
[`authSession.ts`](src/authSession.ts) probes `/me` with a non-redirecting client so the
welcome screen can show before login. Pass the auth-aware `fetch` into
`server={{ type: 'trueforge', fetch }}` so the built-in Harness adapter shares the same
session cookies.

### Server adapter (in the UI package)

Harness ↔ `AgentUIServer` mapping lives in
[`@truefoundry/trueforge-ui/plugins/trueforge-agent-server-adapter`](../trueforge-ui/src/plugins/trueforge-agent-server-adapter/).
Hosts that need the factory outside `<TrueForgeUI />` can import
`createTrueForgeAgentUIServer` from that subpath.

## Production

There is no frontend image. `pnpm build` writes `dist/` plus `.br`/`.gz` siblings
(`vite-plugin-compression2`) that the server serves from `FRONTEND_DIR`, sharing one origin with the API.
The Monaco workers land outside Vite's asset pipeline and cannot be precompressed, so the server gzips
those on the fly.

```bash
docker compose up --build   # UI + API on http://localhost:8791
```

## Gaps

| Item                                  | Status                                   |
| ------------------------------------- | ---------------------------------------- |
| Subscribe turn SSE                    | Deferred (route defined, not registered) |
| Attachments / sandbox download        | Off                                      |
| Session `type` / `created_by_subject` | Soft — not required for this FE          |
| `turn.created.created_by`             | Soft — stream adopt tolerates missing    |

## Scripts

| Script           | Action                        |
| ---------------- | ----------------------------- |
| `pnpm dev`       | Vite dev server               |
| `pnpm build`     | Typecheck + production bundle |
| `pnpm typecheck` | `tsc --noEmit`                |
| `pnpm test`      | Auth unit tests               |
