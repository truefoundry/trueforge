# @truefoundry/trueforge review rules

Included when reviewing files under `packages/trueforge`. Repo-wide rules are in the root `.cursor/BUGBOT.md`. Do not re-flag generated OpenAPI/SDK edits; that check lives in the root file.

## Environment variables

Flag `process.env` reads in `packages/trueforge/src/**` other than `config.ts` and documented bootstrap in `cli.ts` (flags applied before `./main` import because config reads env at module load).

Do not flag tests. Do not flag `logger.ts` `NO_COLOR` / `FORCE_COLOR` reads unless that file grows unrelated env reads.

## Transactions

Flag `withTransaction` callbacks that `await` `fetch`, an SDK client, Redis, or other remote I/O (including through helpers). Finish remote work before opening the txn. Callbacks must only do local DB work.

`withTransaction` is `db.transaction().execute(callback)`: commits on resolve, rolls back on throw. Return domain data from the callback; build success `c.json(...)` after it. Flag `return c.json({ error: ... }, status)` inside the callback — a returned Response commits while the client still sees an error. Failures that must undo writes must `throw` (e.g. `HTTPException`).

## OpenAPI naming

Wire fields stay `snake_case` (also covered at repo root). New endpoints must follow this convention; renaming shipped schemas breaks `packages/trueforge-sdk`.

**Paths:** plural kebab under `/api/v1/{collection}`, nested `/…/{id}/{subcollection}`, settings `/api/v1/settings/{collection}`, catalogs `/api/v1/catalogs/{collection}`. Ids as `{resource}_id`; name-keyed ops use `{name}` — do not mix id and name across verbs for one resource.

If a settings resource is one-per-tenant (e.g. sandbox provider), keep the plural path `/api/v1/settings/sandbox-providers` for URL consistency, but Fern methods are `get`/`create_or_update` returning a single object — not `list` returning an array.

**Verbs:** `GET` list/get → 200; `POST` create → **201**; `PUT` replace/upsert → 200; `DELETE` → **200** with `DeleteFooResponse` (`{}`), optional `DeleteFoosRequestQuery`; actions `POST /{id}/{action}`.

**Schemas** (resource `Foo`, collection `foos`; item OpenAPI name is PascalCase singular):

| Operation               | Request                             | Response                                  |
| ----------------------- | ----------------------------------- | ----------------------------------------- |
| `GET /foos`             | `ListFoosRequestQuery` (if any)     | `ListFoosResponse`                        |
| `POST /foos`            | `CreateFooRequest`                  | `GetFooResponse` (or `CreateFooResponse`) |
| `GET /foos/{foo_id}`    | —                                   | `GetFooResponse`                          |
| `PUT` upsert/replace    | `UpdateFooRequest`                  | `GetFooResponse` (or `UpdateFooResponse`) |
| `DELETE /foos/{foo_id}` | `DeleteFoosRequestQuery` (optional) | `DeleteFooResponse` (`{}`)                |

Prefer reusing `GetFooResponse` when create/update return the same item.

**Request body vs manifest:** `FooManifest` is only the persisted jsonb document. Flag create/update bodies that flatten manifest fields onto the request root or alias the request schema to `FooManifest`. They must be `CreateFooRequest` / `UpdateFooRequest` with an explicit wrapper:

```ts
{
  manifest: FooManifest; // stored document only
  dry_run?: boolean;     // operation-level fields live beside manifest
}
```

Session/turn-style creates that are not a stored manifest keep a flat `Create*Request` without a `manifest` key.

Settings list → `ListFoosResponse`; chat → `ListAvailableFoosResponse`. Catalogs are a single `GET /api/v1/catalogs/{collection}` of the whole blob → `GetFooCatalogResponse` / item `CatalogFoo` (not a `ListCatalog*` list endpoint).

Nested child `Bar`: `ListBarsResponse`, `CreateBarRequest`, `GetBarResponse`; Fern `list_bars`, `create_bar`, …

**Envelopes:** success `{ data: Item | Item[] }` (+ `pagination` via `fernExtensions.ts` token contract); errors `RequestErrorResponse`.

**Fern:** set `x-fern-sdk-group-name` / `x-fern-sdk-method-name` (`list`/`get`/`create`/`update`/`create_or_update`/`delete` + snake_case actions). Flag `x-fern-sdk-method-name: upsert` — PUT create-or-replace must be `create_or_update`. Schemas live in `src/schemas/` with matching `.openapi('…')` names; types via `z.infer`.

**No inline object schemas:** flag anonymous `z.object({ … })` nested inside another object. Extract each nested object as a top-level named schema with a meaningful `.openapi('…')` name (e.g. `FooAuth`, `FooManifest`). Primitives, arrays of primitives, and `$ref`s to existing named schemas are fine inline.

**Avoid `allOf`:** new wire schemas must emit flat OpenAPI objects.

- Flag `z.merge` — prefer `z.object({ ...A.shape, ...B.shape })` or leave bases unnamed and `.extend` only then.
- Flag `.extend()` on a schema that already has `.openapi('Name')` — use `z.object({ ...Base.shape, … })` or leave the base unnamed.
- Flag `.describe()` on a named `$ref` field (`NameSchema.describe(…)`) — describe the shared schema once, or inline constraints.
- Discriminated `oneOf` for real polymorphism is fine; flag a one-member `oneOf`. Single-variant unions must be a plain object alias.

## Postgres

Flag temporal columns that are `timestamp` without time zone. Use `timestamptz`.

Flag application timestamps that are not treated as UTC instants. Serialize with `Date.prototype.toISOString()` (always `...Z` with milliseconds).

Flag DB queries inside loops (N+1). Prefer a single batched query, a join, or an `IN`/`ANY` lookup.

Flag Postgres migrations whose `up`/`down` do not start with `SET LOCAL lock_timeout = '5s'`.

## SQLite

Flag JSON projection aliases missing from `client.ts` `JSON_RESULT_COLUMNS`.

Kysely's SqliteAdapter keeps `supportsTransactionalDdl: false`, so Migrator does not wrap migrations. Flag every schema-touching `up`/`down` that does not open `db.transaction()` itself. `PRAGMA foreign_keys` is a no-op inside a transaction — toggle it outside the txn when rebuilding a referenced parent.

## Persisted JSON schemas

If a Zod schema that backs persisted JSON (e.g. `model_provider.manifest`) changes in a breaking way, flag unless the change includes a data migration or rewrite for existing rows.
