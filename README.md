# TrueForge

**The open-source agent harness - the runtime layer that turns an LLM into a working agent.**

TrueForge runs the agent execution loop for you - model calls, tool use, context management, and session state - and exposes the result three ways: a chat UI, an HTTP API, and a TypeScript library.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js >= 22.13](https://img.shields.io/badge/Node.js-%3E%3D22.13-green.svg)](https://nodejs.org)

<!-- TODO: replace placeholder links below with real URLs -->

[Documentation](#) · [Quickstart Guide](#) · [API Reference](#) · [Community](#)

![TrueForge Chat UI](./docs/assets/hero.png)

## Why TrueForge?

Building an agent is easy. Running one in production is not - you need streaming, session persistence, tool servers, sandboxing, approvals, and a UI. TrueForge gives you all of that out of the box:

- **Multi-turn sessions with streaming** - resumable turn streams that survive reconnects and server restarts.
- **MCP tool servers** - connect any [Model Context Protocol](https://modelcontextprotocol.io) server, including ones that require OAuth.
- **Any model provider** - OpenAI, Anthropic, Google Gemini, and a catalog of hosted and open-weight models, or any OpenAI-compatible endpoint - all configured from the UI or the API.
- **Skills** - reusable instruction packs the agent loads on demand.
- **Sandboxed code execution** - run agent-generated code in isolated sandboxes.
- **Human-in-the-loop approvals** - pause the agent and wait for a person before sensitive tool calls.
- **Subagents** - agents that delegate work to other agents.
- **Chat UI, HTTP API, and TypeScript library** - use whichever surface fits your product.

It scales down and up: run it as a single process backed by SQLite, or run multiple replicas backed by Postgres and Redis.

## Quick start

### Option 1: npx (fastest)

<!-- TODO: remote this note after packages are published -->

> Note: This option will be available when packages are published to NPM. Please use Option 2

Requires [Node.js](https://nodejs.org) 22.13 or newer. One command, no other infrastructure - data is stored in a local SQLite file:

```bash
npx @truefoundry/trueforge
```

Then open [http://localhost:8790](http://localhost:8790), add a model provider under **Settings**, and start chatting.

### Option 2: From source (pnpm)

Runs the standalone (SQLite) topology from a clone of this repo — no Docker, no Postgres, no Redis. Requires [Node.js](https://nodejs.org) 22.13+ and [pnpm](https://pnpm.io)

```bash
git clone https://github.com/truefoundry/trueforge.git
cd trueforge
cp packages/server/.env.example packages/server/.env
pnpm standalone:dev
```

Then open [http://localhost:3000](http://localhost:3000) - Vite serves the UI with live reload and proxies API calls to the server on port 8790. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full development guide, including the Postgres + Redis dev topology.

### Option 3: Docker Compose

Runs the full production topology on your machine: the server (UI + API), Postgres, and Redis. Clone the repo first:

```bash
git clone https://github.com/truefoundry/trueforge.git
cd trueforge
cp packages/server/.env.example packages/server/.env
docker compose up --build
```

Then open [http://localhost:8791](http://localhost:8791).

| Configuration                                               | Default                 | Description                                                                                                  |
| ----------------------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB`       | `harness` (from `.env`) | Postgres credentials, read from `packages/server/.env`.                                                      |
| `PUBLIC_BASE_URL`                                           | `http://localhost:8791` | Public origin, used for MCP OAuth callbacks.                                                                 |
| Host ports                                                  | `8791`, `5433`, `6380`  | App, Postgres, and Redis - offset so they don't clash with local dev.                                        |
| `OIDC_ISSUER_URL` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | unset                   | Optional IdP. Unset = local admin. When set, APIs accept the ID token via cookie or `Authorization: Bearer`. |

Every environment variable is documented in [`packages/server/.env.example`](packages/server/.env.example).

### Option 4: Kubernetes (Helm)

The [`charts/truefoundry-utils`](charts/truefoundry-utils) Helm chart deploys the server in distributed mode (`STANDALONE=false`) with bundled Postgres and Redis (or point it at your own). No values are required for a basic install:

<!-- TODO: replace <HELM_REPO> with the published Helm repo URL -->

```bash
helm install truefoundry-utils oci://<HELM_REPO>/truefoundry-utils \
  --version <x.y.z>
```

| Configuration          | Default | Description                                                                    |
| ---------------------- | ------- | ------------------------------------------------------------------------------ |
| `server.publicBaseUrl` | `""`    | Public origin for MCP OAuth / OIDC callbacks; set once you expose the service. |
| `replicaCount`         | `1`     | Number of server replicas (turn cancel/streaming peers over Redis).            |
| `postgresql.enabled`   | `true`  | Bundle Postgres; set `false` and fill `externalPostgres.*` to bring your own.  |
| `redis.enabled`        | `true`  | Bundle Redis; set `false` and set `externalRedis.url` or `existingSecret`.     |
| `autoscaling.enabled`  | `false` | Enable a HorizontalPodAutoscaler.                                              |

See the [chart README](charts/truefoundry-utils/README.md) for Secrets, external databases, ingress via `extraObjects`, and the full values reference.

## Getting Started Walkthrough

1. **Add a model provider** - Open **Settings → Models**, pick a provider from the catalog, and paste your API key.

   ![Configure a model provider](./docs/assets/getting-started-provider.png)

2. **(Optional) Connect tools** - Add MCP servers, skills, and a sandbox provider under **Settings**.

   ![Connectors](./docs/assets/getting-started-connectors.png)

3. **(Optional) Configure Sandbox** - Open **Settings → Sandbox Providers** and configure Daytona.

   Sign up with [Daytona](https://app.daytona.io/) and create an API Key with permissions to write, delete snapshots and write sandboxes

   ![Daytona API Key](./docs/assets/daytona-api-key.png)

   Sync the sandbox image to Daytona

   ```bash
   export DAYTONA_API_KEY="dtn_your-daytona-api-key-..."
   pnpm push-sandbox-image-to-daytona --image docker.io/truefoundrycloud/truefoundry-utils-core-sandbox:029ea5ff6438cf86b79282e087bfc17528067946 --name trueforge-sandbox-image
   ```

   On UI, select the Daytona sandbox provider and enter your Daytona API Key and the name of the snapshot you created above

   ![Daytona Sandbox Provider](./docs/assets/getting-started-sandbox-provider.png)

4. **Start a session** - Create a chat and talk to your agent. Streaming, tool calls, and approvals all show up live in the UI.

   ![Chat with the agent](./docs/assets/getting-started-chat.png)

Interactive API docs are served by your running instance at `/api/v1/docs`. For everything else, see the [documentation](#). <!-- TODO: docs link -->

## Components

TrueForge is a single container image (or `npx` process) plus a database - and Redis when you run more than one replica.

```mermaid
flowchart LR
  browser([Browser])
  subgraph server [TrueForge server]
    ui[Chat UI]
    api[HTTP API]
  end
  db[(Postgres or SQLite)]
  redis[(Redis)]
  llm[Model providers]
  mcp[MCP servers]
  sandbox[Sandboxes]

  browser --> ui
  browser --> api
  api --> db
  api <--> redis
  api --> llm
  api --> mcp
  api --> sandbox
```

| Component             | What it does                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| **UI**                | React chat interface, bundled into the server image and served on the same port as the API.         |
| **Backend**           | Node.js (Hono) server: the agent execution loop, sessions, streaming, settings, and OpenAPI docs.   |
| **Postgres / SQLite** | Session and settings storage. SQLite in standalone mode; Postgres for multi-replica deployments.    |
| **Redis**             | Cross-replica peering (turn cancellation and stream handoff). Only needed when running > 1 replica. |

### Deployment modes

|             | Standalone                       | Multi-replica                        |
| ----------- | -------------------------------- | ------------------------------------ |
| Best for    | Trying it out, single-user, edge | Production, teams, high availability |
| Processes   | One                              | One or more, peered over Redis       |
| Database    | SQLite                           | Postgres                             |
| Extra infra | None                             | Postgres + Redis                     |
| How to run  | `npx @truefoundry/trueforge`     | Docker Compose or the Helm chart     |

## Documentation

<!-- TODO: replace placeholder links with real URLs -->

- [Introduction](#)
- [Quickstart](#)
- [Configuration reference](#)
- [API reference](#)
- [Deploying to Kubernetes](#)

## Benchmarks

We compare TrueForge against other agent frameworks (Claude Managed Agents, deepagents) on the same tasks, the same model, and the same prompt, and report accuracy alongside cost and latency. The harness, the exact prompt, the blind grader, and our results all live in [`benchmark/`](benchmark/) - and it is built to be re-run against your own dataset and models.

## Contributing

We love contributions! Whether it's a bug report, a new feature, or a docs fix - see [CONTRIBUTING.md](CONTRIBUTING.md) for how to set up a development environment and open a pull request. Please also read our [Code of Conduct](CODE_OF_CONDUCT.md).

To report a security vulnerability, please follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## License

TrueForge is released under the [MIT License](LICENSE).
