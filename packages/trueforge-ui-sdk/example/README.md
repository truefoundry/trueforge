# Example app

Minimal Vite + React demo for `@truefoundry/trueforge-ui`.

## Setup

1. Build the SDK from the repo root (the example depends on `link:..` / `dist/`):

```bash
cd ..
yarn install --ignore-engines
yarn build
```

`link:..` symlinks the SDK so example picks up a fresh `dist/` after each
`yarn build`. Re-run `yarn` in `example/` if the link is missing. The example
imports Tailwind via `@tailwindcss/vite` (`@import "tailwindcss"` in
`src/index.css`) for preflight, since the SDK does not ship it.

2. Configure env:

```bash
cd example
cp .env.example .env
```

Fill in:

| Variable                     | Description                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `VITE_TFY_API_KEY`           | TrueFoundry API key                                                                                    |
| `VITE_TFY_CONTROL_PLANE_URL` | Control Plane base URL (required for `type: "truefoundry"`)                                            |
| `VITE_TFY_GATEWAY_URL`       | Optional gateway base URL; when omitted, resolved from CP                                              |
| `VITE_TFY_AGENT_NAME`        | Named agent for `SingleAgent` mode (default `ask-ai-agent`)                                            |
| `VITE_TFY_AGENT_MODE`        | Shell mode: `SingleAgent` \| `AgentLibrary` \| `AgentComposer` \| `AgentLibraryWithComposer` (default) |

API keys in client env are for local demos only — keep secrets on a server in production.

3. Install and run:

```bash
yarn
yarn dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

The demo uses `server={{ type: "truefoundry", … }}` so `<TrueforgeUI />` builds
the agent UI server from the control plane + API key (same path as production
TrueFoundry hosts). Pass `agentConfig` to pick shell mode (see `src/App.tsx`).
Default mode is **AgentLibraryWithComposer**. Change `VITE_TFY_AGENT_MODE` to
try the other modes.
