# TrueForge example agents

This directory contains example agents for TrueForge. Each folder holds an
`agent.json` (the agent definition) and a README describing what the agent does
and how to run it. They are intended as starting points to copy and adapt.

The examples use connectors that authenticate with either no credentials or a
personal key or free account. Credentials are configured on the connector in
Settings and are never stored in the agent files, so the `agent.json` files can
be copied and shared without exposing secrets.

## Examples

| Example                                          | What it does                                           | Connectors       | Auth              | Sandbox |
| ------------------------------------------------ | ------------------------------------------------------ | ---------------- | ----------------- | ------- |
| [security-auditor](./security-auditor)           | Audit a repository for vulnerabilities and file issues | github, exa      | GitHub token      | yes     |
| [claim-red-teamer](./claim-red-teamer)           | Fact-check a claim or answer against sources           | exa              | none              | no      |
| [decision-brief](./decision-brief)               | Compare options into a scored, sourced brief           | exa or tavily    | none, or free key | yes     |
| [codebase-onboarding](./codebase-onboarding)     | Generate a "start here" guide for a repository         | deepwiki, github | GitHub token      | yes     |
| [ci-fixer](./ci-fixer)                           | Diagnose and patch a failing pull request              | github           | GitHub token      | yes     |
| [db-analyst](./db-analyst)                       | Answer questions about a database with SQL and charts  | supabase         | free account      | yes     |
| [issue-triage](./issue-triage)                   | Turn raw reports into structured tracker issues        | linear           | free account      | yes     |
| [incident-investigator](./incident-investigator) | Investigate a Sentry error and write it up             | sentry           | free account      | yes     |
| [knowledge-capture](./knowledge-capture)         | File notes into organized Notion pages                 | notion           | free account      | yes     |
| [bring-your-own-mcp](./bring-your-own-mcp)       | Connect a custom HTTP API to an agent                  | your own         | none (demo)       | no      |

`bring-your-own-mcp` includes a small MCP server you can copy to connect a
custom HTTP API, for use cases that need data beyond the built-in connectors.

## Running an example

1. **Set the model.** Each `agent.json` has `"model": { "name": "REPLACE_WITH_YOUR_MODEL" }`.
   Replace it with a model you have configured. The available names are returned
   by `GET /api/v1/models`, for example `openai/gpt-5.2` or `anthropic/claude-sonnet-5`.
2. **Add the connectors** the example lists, under Settings, Connectors. The
   catalog includes deepwiki, exa, tavily, github, supabase, linear, sentry, and
   notion, among others. For key or account based connectors, you authenticate
   here and TrueForge stores the credential.
3. **Add any skills and a sandbox.** If the example uses skills, add them under
   Settings, Skills. Skills run in the sandbox, so also connect one under
   Settings, Sandbox providers. Examples that use Code Mode need a sandbox too.
4. **Create the agent.** Paste the spec in the UI, or post it to the API:
   ```bash
   curl -X POST http://localhost:8790/api/v1/agents \
     -H 'content-type: application/json' \
     -d "{\"name\":\"security-auditor\",\"manifest\":$(cat examples/security-auditor/agent.json)}"
   ```
   Then open a session in the UI or through the SDK.

## How the examples are structured

An agent is a JSON document: a model, instructions, the connectors and skills it
may use, and configuration. The examples use several TrueForge features:

- **Sub-agents** run a piece of work in a separate context and return a summary,
  which lets an agent process many items in parallel. Enabled by default.
- **Code Mode** runs Python in the sandbox, so counts and scores are computed
  rather than estimated.
- **Skills** are git-backed instruction packs loaded on demand. They run in the
  sandbox.
- **Approvals** hold any tool that writes or deletes until the user approves it.
  Read-only tools run without interruption.
- **Generative UI** lets an agent render tables and cards in the chat.

These features are provided by the harness and require no per-example setup
unless a README notes otherwise.
