# @truefoundry/trueforge-core review rules

Included when reviewing files under `packages/trueforge-core`. Repo-wide rules are in the root `.cursor/BUGBOT.md`.

## Package exports and dist

Flag a `"trueforge-dev"` export condition renamed to `"development"` or `"production"`. Workspace source must stay ESM so that condition can load `src/` without a build. The package publishes from its own root with `files: ["dist", "README.md"]`, so `src/` is never in the tarball; Vite/webpack auto-activate a literal `"development"` condition in dev mode with no consumer opt-in.

Flag `dist/` output that does not expose CJS `.js` and ESM `.mjs` alongside `.d.ts`.

## Optional properties

Top-level public package surfaces (`core`, `agent-session`, and other exported entrypoints) MAY use optional (`?`) properties.

Flag `?` on internal records, snapshots, store INPUT types, and other internal contracts. Absence must be an explicit required `| null` or `| undefined` field. Prefer `null` for domain absence; use `undefined` only when update/patch semantics must distinguish “not provided” from “clear.” Public surfaces must supply those explicit absences when calling inward.

## Session store

`ISessionStore` is the session/turn persistence contract (no streaming/SSE). Postgres, SQLite, and `InMemorySessionStore` must implement it. Shared behavior must live in `storeContractSuite.ts`; backend wrappers only bind a store.

If an `ISessionStore` method, input, error, or semantic changes, flag unless the interface, every implementation, and the contract suite are updated in the same change.

If store or contract-test paths are added, moved, or renamed, flag unless the `store` path filter in `.github/workflows/ci.yml` stays synchronized.

## Durable runtime state

Flag in-memory mutation that runs before the corresponding event is yielded. Durable state must follow:

```ts
yield event; // consumer persists and may throw
mutateMemory(); // runs only after persistence succeeds
```
