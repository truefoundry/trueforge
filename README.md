<p align="center">
  <a href="https://trueforge.dev">
    <picture>
      <source srcset="./docs/assets/trueforge-black.svg" media="(prefers-color-scheme: light)">
      <source srcset="./docs/assets/trueforge-white.svg" media="(prefers-color-scheme: dark)">
      <img src="./docs/assets/trueforge-black.svg" alt="TrueForge logo">
    </picture>
  </a>
</p>
<p align="center">The open-source agent harness - the runtime layer that turns an LLM into a working agent</p>

<p align="center">
  <a href="https://trendshift.io/repositories/155463?utm_source=trendshift-badge&amp;utm_medium=badge&amp;utm_campaign=badge-trendshift-155463" target="_blank" rel="noopener noreferrer"><img src="https://trendshift.io/api/badge/trendshift/repositories/155463/daily?language=TypeScript" alt="truefoundry%2Ftrueforge | Trendshift" width="250" height="55"/></a>
</p>

<p align="center">
  <a href="https://github.com/truefoundry/trueforge/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="License: MIT"></a>
  <a href="https://nodejs.org"><img src="https://img.shields.io/badge/Node.js-%3E%3D22.14-green.svg?style=flat-square" alt="Node.js >= 22.14"></a>
  <a href="https://trueforge.dev"><img src="https://img.shields.io/badge/Documentation-trueforge.dev-blue.svg?style=flat-square" alt="Documentation"></a>
  <a href="https://trueforge.dev/quickstart"><img src="https://img.shields.io/badge/Quickstart-trueforge.dev/quickstart-blue.svg?style=flat-square" alt="Quickstart"></a>
  <a href="https://trueforge.dev/api/overview"><img src="https://img.shields.io/badge/SDK-trueforge.dev/api/overview-blue.svg?style=flat-square" alt="SDK"></a>
</p>
<p align="center">
  <a href="https://www.npmjs.com/package/@truefoundry/trueforge"><img src="https://img.shields.io/npm/v/@truefoundry/trueforge?label=trueforge&logo=npm&style=flat-square" alt="npm @truefoundry/trueforge"></a>
  <a href="https://www.npmjs.com/package/@truefoundry/trueforge-sdk"><img src="https://img.shields.io/npm/v/@truefoundry/trueforge-sdk?label=trueforge-sdk&logo=npm&style=flat-square" alt="npm @truefoundry/trueforge-sdk"></a>
  <a href="https://www.npmjs.com/package/@truefoundry/trueforge-ui"><img src="https://img.shields.io/npm/v/@truefoundry/trueforge-ui?label=trueforge-ui&logo=npm&style=flat-square" alt="npm @truefoundry/trueforge-ui"></a>
  <a href="https://www.npmjs.com/package/@truefoundry/trueforge-core"><img src="https://img.shields.io/npm/v/@truefoundry/trueforge-core?label=trueforge-core&logo=npm&style=flat-square" alt="npm @truefoundry/trueforge-core"></a>
  <a href="https://tfy.jfrog.io/ui/packages/oci:%2F%2Ftrueforge"><img src="https://img.shields.io/badge/dynamic/yaml?url=https%3A%2F%2Fraw.githubusercontent.com%2Ftruefoundry%2Ftrueforge%2Frefs%2Fheads%2Fmain%2Fcharts%2Ftrueforge%2FChart.yaml&query=%24.version&label=trueforge&logo=helm&style=flat-square" alt="helm trueforge"></a>
  <a href="https://deepwiki.com/truefoundry/trueforge"><img src="https://deepwiki.com/badge.svg?style=flat-square" alt="Ask DeepWiki"></a>
</p>

# TrueForge

TrueForge runs the agent execution loop for you - model calls, MCP tools, skills, sandboxing, approvals, context management, and session state - and exposes it three ways: a **chat UI**, an **HTTP API** with a TypeScript **SDK**, and an embeddable **UI SDK**.

![TrueForge Chat UI](./docs/images/hero.png)

## Why TrueForge?

Building an agent is easy. Running one well is not - you need streaming, session persistence, tool servers, sandboxing, approvals, and a UI. TrueForge gives you that out of the box:

- **Initial setup from catalogs** - configure [models](https://trueforge.dev/models), [MCP servers](https://trueforge.dev/mcp-servers), [skills](https://trueforge.dev/skills), and a [sandbox](https://trueforge.dev/sandbox) once; agents pick from what you connected. Presets come from shipped YAML catalogs you can customize.
- **Any model provider** - OpenAI, Anthropic, Google Gemini, and other catalog providers, or any OpenAI-compatible endpoint.
- **MCP tools** - remote MCP servers with header auth or OAuth, including in-chat authorization.
- **Skills** - git-backed `SKILL.md` instruction packs, loaded on demand in the sandbox.
- **Sandbox as a tool** - isolated code/file execution (Daytona today; more providers planned), provisioned only when needed. Secrets stay in the harness.
- **Human checkpoints** - tool approval, ask-user-questions, and Generative UI in chat.
- **Context engineering** - subagents, deferred tool loading, Code Mode, large-result offloading, and compaction.
- **Chat UI + SDK** - use the bundled UI, automate with `@truefoundry/trueforge-sdk`, or embed `@truefoundry/trueforge-ui`.

It scales down and up: **local mode** (one process, SQLite) or **hosted mode** (Postgres + Redis, Docker Compose, Helm, or Railway).

## Getting started

### Quickstart with `npx`

```
npx @truefoundry/trueforge@latest
```

Use the [Quickstart](https://trueforge.dev/quickstart) guide to run TrueForge using various methods (Local, Docker Compose, Kubernetes, or Railway). Connect models, tools, skills and build your first reusable agent.

To work on TrueForge from this repository, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Architecture

<p align="center">
  <picture>
    <source srcset="./docs/assets/architecture-dark.svg" media="(prefers-color-scheme: dark)">
    <source srcset="./docs/assets/architecture-light.svg" media="(prefers-color-scheme: light)">
    <img src="./docs/assets/architecture-light.svg" alt="TrueForge architecture: Chat UI and SDK connect to the TrueForge server HTTP API and agent loop, which talks to SQLite or Postgres and bring-your-own models, MCP servers, and sandbox" width="920">
  </picture>
</p>

| Mode   | Best for                    | Storage  | Extra infra      | How to run                       |
| ------ | --------------------------- | -------- | ---------------- | -------------------------------- |
| Local  | Personal use, trying it out | SQLite   | None             | `npx @truefoundry/trueforge`     |
| Hosted | Teams, multi-replica        | Postgres | Postgres + Redis | Docker Compose, Helm, or Railway |

> **Local mode is for your machine only.** It is a convenient way to try TrueForge — not a production or internet-facing setup. There is no login by default, and data lives in a local SQLite file. Please keep it on localhost. We cannot take responsibility for data loss or unauthorized access if local mode is used beyond that. For a shared or production deployment, use hosted mode.

## Documentation

| Section                                                             | What you'll find                                                  |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [Introduction](https://trueforge.dev/introduction)                  | What an agent harness is and how TrueForge fits together          |
| [Quickstart](https://trueforge.dev/quickstart)                      | Run local or hosted, build your first agent                       |
| [Initial Setup](https://trueforge.dev/harness/initial-setup)        | Models, MCP, skills, sandbox - catalogs and overrides             |
| [Create an Agent](https://trueforge.dev/create-agent/overview)      | Select resources; tool approval, questions, Generative UI         |
| [Harness Capabilities](https://trueforge.dev/key-features/overview) | Sandbox-as-tool, subagents, deferred tools, Code Mode, compaction |
| [Setup Login](https://trueforge.dev/authentication/overview)        | Optional OIDC for shared deployments                              |
| [Benchmarking](https://trueforge.dev/benchmarking)                  | Cost/accuracy vs Claude Managed Agents and deepagents             |
| [SDK](https://trueforge.dev/api/overview)                           | TypeScript client: sessions, turns, events                        |
| [Chat UI](https://trueforge.dev/chat-ui)                            | Bundled UI and embedding `@truefoundry/trueforge-ui`              |
| [API Reference](https://trueforge.dev/api-reference)                | OpenAPI paths and schemas                                         |

## Benchmarks

We compare TrueForge against Claude Managed Agents and deepagents on the same tasks, tools, and model - same accuracy, lower cost. Reproduce it from [`benchmark/`](benchmark/). Write-up: [Benchmarking](https://trueforge.dev/benchmarking).

## Contributing

We love contributions - bug reports, features, and docs fixes. See [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md). Fork PRs should change source only; maintainers regenerate the SDK after merge.

To report a security vulnerability, follow [SECURITY.md](SECURITY.md) instead of opening a public issue.

## Talk to us

- [Community Discord](https://discord.com/invite/fHeGRvakb)
- Founder emails: [abhishek@truefoundry.com](mailto:abhishek@truefoundry.com) / [anuraag@truefoundry.com](mailto:anuraag@truefoundry.com)

## License

TrueForge is released under the [MIT License](LICENSE).
