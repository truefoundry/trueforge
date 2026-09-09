- `withTransaction` callbacks MUST only do local DB work: no `await` of `fetch`, an SDK client, Redis, or other remote I/O (including through helpers). Finish remote work before opening the txn.
- `withTransaction` is `db.transaction().execute(callback)`: commits on resolve, rolls back on throw. Return domain data from the callback; build success `c.json(...)` after it. Failures that must undo writes MUST `throw` (e.g. `HTTPException`); MUST NOT `return c.json({ error: ... }, status)` inside — a returned Response commits while the client still sees an error.

### OpenAPI naming convention

Wire fields stay `snake_case`. New endpoints MUST follow this; renames of shipped schemas break `packages/trueforge-sdk`.

**Paths:** plural kebab under `/api/v1/{collection}`, nested `/…/{id}/{subcollection}`, settings `/api/v1/settings/{collection}`, catalogs `/api/v1/catalogs/{collection}`, internal `/api/internal/{collection}`. Ids as `{resource}_id`; name-keyed ops use `{name}` — do not mix id and name across verbs for one resource.

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

Prefer reusing `GetFooResponse` when create/update return the same item. `GET /auth/me` is `GetMeResponse`. Acronyms in OpenAPI names stay uppercase (`MCPServer`, not `McpServer`).

**Request body vs manifest:** `FooManifest` is only the persisted jsonb document. Create/update OpenAPI bodies MUST be `CreateFooRequest` / `UpdateFooRequest` with an explicit wrapper — never flatten manifest fields onto the request root and never alias the request schema to `FooManifest`:

```ts
// CreateFooRequest / UpdateFooRequest
{
  manifest: FooManifest; // stored document only
  dry_run?: boolean;     // operation-level fields live beside manifest
}
```

Session/turn-style creates that are not a stored manifest keep a flat `Create*Request` without a `manifest` key.

Settings list → `ListFoosResponse`; chat → `ListAvailableFoosResponse`. Catalogs are a single `GET /api/v1/catalogs/{collection}` of the whole blob → `GetFooCatalogResponse` / item `CatalogFoo` (not a `ListCatalog*` list endpoint).

Nested child `Bar`: `ListBarsResponse`, `CreateBarRequest`, `GetBarResponse`; Fern `list_bars`, `create_bar`, …

**Envelopes:** success `{ data: Item | Item[] }` (+ `pagination` via `fernExtensions.ts` token contract); errors `RequestErrorResponse`.

**Fern:** set `x-fern-sdk-group-name` / `x-fern-sdk-method-name` (`list`/`get`/`create`/`update`/`create_or_update`/`delete` + snake_case actions). PUT create-or-replace MUST use `create_or_update`, never `upsert`. Do not hand-edit OpenAPI or `packages/trueforge-sdk`. Schemas live in `src/schemas/` with matching `.openapi('…')` names; types via `z.infer`.

**No inline object schemas:** do not nest anonymous `z.object({ … })` inside another object. Extract each nested object as a top-level named schema with a meaningful `.openapi('…')` name (e.g. `FooAuth`, `FooManifest`) so OpenAPI emits a `$ref` and other schemas can reuse it. Primitives, arrays of primitives, and `$ref`s to existing named schemas are fine inline.

**Avoid `allOf`:** new wire schemas MUST emit flat OpenAPI objects.

- **MUST NOT use `z.merge`** — it is a footgun (opaque composition, OpenAPI `allOf`, surprising overrides). Prefer `z.object({ ...A.shape, ...B.shape })` or leave bases unnamed and `.extend` only then.
- Do not `.extend()` a schema that already has `.openapi('Name')` — use `z.object({ ...Base.shape, … })` or leave the base unnamed.
- Do not `.describe()` a named `$ref` field (`NameSchema.describe(…)`) — describe the shared schema once, or inline constraints.
- Discriminated `oneOf` for real polymorphism is fine; single-variant unions MUST be a plain object alias (no one-member `oneOf`).
