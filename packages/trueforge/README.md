# @truefoundry/trueforge

[Documentation](https://trueforge.dev) · [Quickstart](https://trueforge.dev/quickstart) · [npm](https://www.npmjs.com/package/@truefoundry/trueforge) · [GitHub](https://github.com/truefoundry/trueforge)

The open-source agent harness — the runtime that turns an LLM into a working agent.

TrueForge runs the agent loop (model calls, MCP tools, skills, sandboxing, approvals, context management, and session state) and exposes it as a **chat UI**, an **HTTP API**, and a TypeScript **SDK**.

## Quick start

Requires [Node.js](https://nodejs.org) 22.14+.

```bash
npx @truefoundry/trueforge
```

Open [http://localhost:8790](http://localhost:8790). This is local mode (one process, SQLite) — for your machine only.

## Private repository credentials

Set `REPOSITORY_CREDENTIAL_RESOLVER_URL` to enable repository credentials for the packaged server. For each turn whose repository has a `credential_provider_ref`, TrueForge sends the resolver a JSON `POST` with that opaque reference, tenant/session/user context, and the repository `url`, `ref`, and `access` fields. The resolver must respond with Git credential-store content:

```json
{ "credentials": "https://username:password@git.example.com\n" }
```

`REPOSITORY_CREDENTIAL_RESOLVER_AUTHORIZATION` optionally sets the complete outbound `Authorization` header. Request timeout and maximum response size default to 10 seconds and 64 KiB and can be changed with `REPOSITORY_CREDENTIAL_RESOLVER_TIMEOUT_MS` and `REPOSITORY_CREDENTIAL_RESOLVER_MAX_RESPONSE_BYTES`.

Resolver bodies and returned credentials are not logged or persisted. If the resolver is unset, unavailable, rejects the request, or returns an invalid response, repository provisioning fails closed.

## Docs

Guides, hosted deployment, API reference, and the UI SDK live at **[trueforge.dev](https://trueforge.dev)**.

## Related packages

- [`@truefoundry/trueforge-sdk`](https://www.npmjs.com/package/@truefoundry/trueforge-sdk) — TypeScript client for the HTTP API
- [`@truefoundry/trueforge-ui`](https://www.npmjs.com/package/@truefoundry/trueforge-ui) — embeddable React chat UI

## License

[MIT](https://github.com/truefoundry/trueforge/blob/main/LICENSE)
