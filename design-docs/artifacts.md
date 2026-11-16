# Artifacts — Project Doc

|                      |                                                                                                                                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Status**           | Draft v3 — review questions closed                                                                                                                                                                                |
| **Owner**            | Abhishek Choudhary                                                                                                                                                                                                |
| **Last updated**     | 2026-11-16                                                                                                                                                                                                        |
| **Packages touched** | `trueforge` (server), `trueforge-core` (sandbox file listing helper), `assistant-ui-runtime` (server port), `trueforge-ui` (publish dialog, Artifacts page, viewer), `charts` / `docker-compose` (storage config) |
| **UI mockups**       | `artifacts-ui-designs.canvas.tsx` (Cursor canvas shared alongside this doc)                                                                                                                                       |

## 1. Summary

Users regularly ask TrueForge agents to produce HTML pages (reports, dashboards, one-pagers) and markdown documents. Today those files exist only inside the session's sandbox. They can be previewed in the chat's file preview panel, but they can't be shared, and they disappear when the sandbox does.

**Artifacts** let a user publish such a file from the preview panel. Publishing:

- copies the file, plus the CSS, JS, images and other files it references, out of the sandbox into durable storage;
- gives the result a stable, shareable link: `https://<trueforge-host>/artifacts/<slug>`.

The link opens a full-page viewer that renders the artifact the same way the preview panel does, with a file browser when the artifact contains more than one file.

Artifacts are versioned. Republishing creates version N+1 under the same link, and every version records which session (and turn) produced it. An **Artifacts** page lists all artifacts and their versions, opens the viewer, and links back to the source sessions.

## 2. Decisions so far

| Topic                                   | Decision                                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| How publishing starts                   | Only from the **Publish** button in the file preview panel. There is no agent tool and no "publish" chat command.               |
| Who can view                            | Any signed-in user of the tenant. No per-artifact access control in v1.                                                         |
| Slug scope                              | Unique **per tenant**.                                                                                                          |
| Who can publish new versions and delete | The artifact's creator or a tenant admin.                                                                                       |
| Deleting an artifact                    | Hard delete. The slug becomes free again.                                                                                       |
| Artifacts page                          | Clicking a row opens the viewer. **Open session** is a separate button on the row.                                              |
| Bundles                                 | **In v1.** An HTML page that references CSS, JS or image files must work, and the viewer can browse every file in the artifact. |
| Choosing files                          | **Automatic.** The server works out every file the page needs. The publish dialog shows a one-line summary, not a file picker.  |
| Description                             | The `artifact.description` column exists but is left blank for now. No UI sets or shows it in v1.                               |
| Download                                | A zip for bundles, the raw file for single-file artifacts. In v1, streamed with `archiver`.                                     |
| File cap                                | **20 files** per version. 10 MB per file, 50 MB per version.                                                                    |
| Missing runtime files                   | Read-only file list in the publish dialog is enough for v1. No manual "add files" control.                                      |
| Content origin                          | Same origin as TrueForge. Isolation comes from the iframe sandbox and the `CSP: sandbox` header. No separate domain in v1.      |
| Storage layout                          | Files are stored under real paths, one prefix per version, like a static site. No content-addressed blobs.                      |

## 3. Goals and non-goals

### Goals (v1)

1. Publish an HTML or markdown file from the preview panel as an artifact with a shareable link. The artifact includes the files that page references (a **bundle**).
2. The user can choose the slug, which must be unique within the tenant. If they don't, one is generated.
3. Versioning: each publish to an existing artifact creates a new immutable version. The link shows the latest version, and `?version=<n>` pins a specific one.
4. Provenance: every version records `session_id`, `turn_id` and the sandbox root it was published from.
5. Pluggable blob storage, with local disk and S3 (including S3-compatible stores) in v1. The design must make adding GCS or Azure Blob a matter of adding one adapter.
6. An Artifacts page that lists artifacts and versions, opens the viewer, and opens the source session.
7. A viewer at `/artifacts/<slug>` that renders the entry page with working relative links, and browses the other files in the bundle.

### Non-goals (v1)

- Per-artifact access control and sharing scopes (§13).
- Links that work without signing in (§13).
- Publishing from an agent tool, from chat, or from content that isn't a sandbox file (for example an assistant message).
- Slug rename and redirects, storage migration between backends, retention policies, and view analytics.
- Server-side rendering of anything other than static files: no build steps, and no backend code in a bundle.

## 4. User experience

The canvas mockups show three screens: _Publish from preview_, _Artifacts page_ and _Artifact viewer_. This section describes the behavior behind them.

### 4.1 Publishing from the preview panel

The **Publish** button sits in the preview panel header next to Download and Close. It is shown only when the previewed file classifies as `html` or `markdown`, the session belongs to the current user, and the sandbox is still reachable.

The publish dialog has these parts.

**Mode**

- _New artifact_ is the default.
- _New version of existing_ preselects the artifact this same file (same session and entry path) was last published as. Otherwise the user picks from the artifacts they can edit.
- In version mode the dialog shows "Publishes as v5 of `<slug>`", plus a change summary against the latest version (files changed, added and removed, computed from content hashes).

**Title**

- Prefilled from the HTML `<title>`, the first markdown `#` heading, or the filename.

**Link**

- The URL prefix is fixed, with an editable slug field.
- The slug is validated as the user types (§6.1), with an availability check.
- If left empty, the server generates a slug from the title.

**Version note**

- Optional free text.

**Files** (the bundle)

- There is no file picker. The server computes the bundle automatically (§6.2) and the dialog shows one summary line, for example "6 files · 382 KB, including `index.html`, `styles.css`, `app.js` and 3 more".
- The summary has a **Show files** link that expands a read-only list, so the user can check what will be published. Nothing in it is editable.
- The dialog only interrupts the user for problems:
  - **Missing file:** the page references a file that doesn't exist in the sandbox, for example `./chart.png`. The user can still publish, and the page will show a broken image.
  - **Over a limit:** the bundle exceeds a limit in §6.3. Publishing is blocked and the message names the limit.
- The dialog has no description field in v1.

**Success state**

- The full link with **Copy link** and **Open artifact** buttons.
- A reminder of who can open it: everyone signed in to the workspace.

### 4.2 Artifacts page: `/artifacts`

A new **Artifacts** sidebar entry, wired the same way as Schedules.

**Toolbar**

- _All_ / _Created by me_ filter pills.
- Search by title or slug.

**Artifact row columns**

| Column         | Notes                                                                                                         |
| -------------- | ------------------------------------------------------------------------------------------------------------- |
| Expand chevron | Shows the version list                                                                                        |
| Title + type   | Type is HTML or Markdown, from the entry file of the latest version                                           |
| Link           | `/artifacts/<slug>` with a copy icon                                                                          |
| Version        | Latest version number                                                                                         |
| Files          | File count of the latest version                                                                              |
| Created by     |                                                                                                               |
| Updated        | Relative time                                                                                                 |
| Actions        | **Open session** (the session of the latest version). The overflow menu has Delete for the creator and admins |

**Row behavior**

- Clicking the row opens the viewer.
- The chevron, copy icon and buttons don't trigger the row click.

**Expanded version rows**

- Columns: version (with a _latest_ tag), note, source session title, file count, author, time.
- Actions: **View** (the viewer pinned to that version) and **Session**. Versions can come from different sessions, so each version links to its own.

**Source session unavailable**

- If the session was deleted, its session button is disabled with a tooltip.
- If the viewer doesn't own the session, the existing session access flow handles it.

### 4.3 Viewer: `/artifacts/<slug>[?version=<n>]`

The viewer is a full-page route that doesn't show the sidebar chrome.

**Top bar**

- A breadcrumb back to Artifacts, and the title.
- "author · time · from `<session title>`" — the session title is a link.
- A version selector showing each version's number, a _latest_ tag and its note.
- On the right: a **Files** toggle (bundles only), **Copy link**, **Open session**, and **Download**. Download gives a zip for bundles and the raw file for single-file artifacts.

**Pinned older version**

- A banner reads: "You are viewing v2. The link without a version always shows the latest. Go to v4."

**Body**

- **Entry HTML:** rendered in a sandboxed iframe loaded from the bundle's content URL (§7), so relative CSS, JS, images and `fetch('./data.csv')` all resolve.
- **Entry markdown:** rendered with the chat `Markdown` component.
  - Relative image paths are rewritten to the bundle's content URL.
  - Relative links to other `.md` files in the bundle open inside the viewer.

**Files panel** (bundles only)

- A tree of the version's files, with the entry marked.
- Selecting a file shows it according to its type:
  - HTML and markdown render as pages;
  - images preview;
  - CSV shows as a table;
  - other text files show syntax-highlighted source (the preview panel's text view).
- A breadcrumb strip shows the selected path, its size, and "Back to `<entry>`".

**Errors**

- An unknown slug shows a not-found page.
- A slug that pointed to a deleted artifact shows the same page, because the slug is freed.

## 5. Data model

Three new tables. Each one needs:

- a migration for Postgres and one for SQLite;
- entries in `types.ts` for both backends;
- a store implementation for each backend behind one `IArtifactStore` interface, following the `schedule` / `schedule_run` pattern.

Ids are ULIDs and timestamps are UTC.

### 5.1 `artifact`

| Column               | Type (PG)            | Notes                                      |
| -------------------- | -------------------- | ------------------------------------------ |
| `id`                 | text PK              | ULID                                       |
| `tenant_id`          | text not null        |                                            |
| `slug`               | text not null        | Immutable in v1                            |
| `title`              | text not null        | Max 200 characters                         |
| `description`        | text null            | Max 2,000 characters                       |
| `latest_version`     | integer not null     | Denormalized for listing and viewer lookup |
| `created_by_subject` | jsonb not null       | `Subject`                                  |
| `created_at`         | timestamptz not null |                                            |
| `updated_at`         | timestamptz not null | Bumped on a new version or a metadata edit |

Indexes:

- `UNIQUE (tenant_id, slug)`
- `(tenant_id, updated_at DESC, id)` for the list page

### 5.2 `artifact_version`

| Column               | Type (PG)            | Notes                                                                        |
| -------------------- | -------------------- | ---------------------------------------------------------------------------- |
| `id`                 | text PK              | ULID                                                                         |
| `tenant_id`          | text not null        |                                                                              |
| `artifact_id`        | text not null        | FK → `artifact.id` `ON DELETE CASCADE`                                       |
| `version`            | integer not null     | 1, 2, 3… per artifact                                                        |
| `entry_path`         | text not null        | Bundle-relative path of the entry file, e.g. `index.html`                    |
| `entry_content_type` | text not null        | `html` \| `markdown`                                                         |
| `file_count`         | integer not null     |                                                                              |
| `total_size_bytes`   | bigint not null      |                                                                              |
| `manifest_sha256`    | text not null        | Hash of the sorted `(path, sha256)` list. Used to skip identical republishes |
| `session_id`         | text not null        | Source session. **No FK**, so artifacts outlive session deletion             |
| `turn_id`            | text not null        | Source turn                                                                  |
| `source_root`        | text not null        | Sandbox directory used as the bundle root                                    |
| `note`               | text null            | Version note                                                                 |
| `storage_backend`    | text not null        | `local` \| `s3`. Backend that holds this version's files                     |
| `storage_location`   | text not null        | Fully qualified prefix that holds this version's files (§8.2)                |
| `created_by_subject` | jsonb not null       |                                                                              |
| `created_at`         | timestamptz not null |                                                                              |

Indexes:

- `UNIQUE (artifact_id, version)`
- `(tenant_id, session_id)` for "artifacts from this session" and the publish dialog's suggestion

### 5.3 `artifact_file`

| Column                | Type (PG)       | Notes                                                                                     |
| --------------------- | --------------- | ----------------------------------------------------------------------------------------- |
| `artifact_version_id` | text not null   | FK → `artifact_version.id` `ON DELETE CASCADE`                                            |
| `tenant_id`           | text not null   |                                                                                           |
| `path`                | text not null   | Bundle-relative and normalized: POSIX separators, no leading `/`, no `.` or `..` segments |
| `size_bytes`          | bigint not null |                                                                                           |
| `sha256`              | text not null   |                                                                                           |
| `media_type`          | text not null   | Derived from the extension at publish time, e.g. `text/css`                               |

Primary key: `(artifact_version_id, path)`.

**Files live at real paths.** A file's object key is `{version storage prefix}/{path}`, so a version is a self-contained directory tree, like a static site. The table records what the version contains (for listings, the file tree and change summaries); the storage backend holds the bytes. The `sha256` column is used for the manifest hash and the change summary, not for storage.

**Storage recorded per version.** `artifact_version` records which backend and prefix hold its files, so if a deployment moves from local disk to S3, old versions stay readable as long as the old backend is still configured (§8.3).

### 5.4 Shared types

- Zod wire schemas live in `packages/trueforge/src/schemas/artifact.ts`, with types derived through `z.infer`.
- The UI port DTOs (`Artifact`, `ArtifactVersion`, `ArtifactFile`, `ArtifactServer`) are defined only in `assistant-ui-runtime/src/server/types.ts`. `trueforge-ui/src/server/types.ts` only re-exports them.

## 6. Behaviour and rules

### 6.1 Slugs

- **Format:** lowercase `[a-z0-9-]`, 3–64 characters, must start and end with an alphanumeric character, and must not contain `--`. Regex: `^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,63}$`. Input is lowercased and trimmed before it's checked.
- **Uniqueness:** enforced by `UNIQUE (tenant_id, slug)`. A conflict returns `409 slug_taken`.
- **Autogeneration:** the title is ASCII-folded and kebab-cased, truncated to 40 characters, then given a 6-character random base36 suffix (for example `q3-revenue-report-k7f2xq`). A collision retries with a new suffix up to 5 times. An empty title falls back to `artifact-<suffix>`.
- **Immutable** in v1.
- **Freed on delete:** the row is gone, so the slug can be reused. Anyone holding an old link will then see whatever artifact now uses the slug. This was accepted for simplicity.
- **Reserved slugs:** `new`, `api`, `assets`, kept free for future sub-routes.

### 6.2 Collecting a bundle from the sandbox

The `SandboxProvider` interface has `downloadFile` and `exec`, but no directory listing.

**Listing files**

- Add a provider-agnostic helper in `trueforge-core`, `listSandboxFiles({ provider, sandboxId, root, limits })`. It runs a bounded, POSIX-portable `find <root> -type f … -exec wc -c {} +` through `exec`. GNU `find -printf` is avoided because the local sandbox runs on macOS hosts with BSD `find`.
- Pruned directories: `.git`, `node_modules`, `.venv` and `__pycache__`.
- The listing stops at a cap so a huge tree can't stall the request.
- This avoids changing the interface of all three providers. If a provider can't run `find`, the dialog falls back to the single-file case.

**Computing the bundle automatically**

The client sends only `session_id`, `turn_id` and `entry_path`. The server does the rest.

1. Start with the entry file and follow references transitively, reading each file it pulls in:
   - HTML: `src`, `href`, `srcset`, `poster`, `<link rel=stylesheet>`, `<script src>`;
   - CSS: `url()` and `@import`;
   - markdown: images and links to other files;
   - JavaScript and JSON: any string literal that is exactly a relative path to a file that exists, such as `fetch('./data/regions.csv')` or `'assets/logo.png'`. Matching only against files that exist keeps false positives harmless.
2. Absolute URLs (`https:`, `//`), `data:` and `#fragment` references are ignored.
3. The **bundle root** is the nearest common ancestor directory of the entry file and every file found. It never goes above the sandbox workspace, and the entry is always included.
4. A reference that doesn't resolve to an existing file is reported as `missing`.
5. References are followed to a bounded depth and file count (the limits in §6.3).

Root-absolute references (`/assets/app.css`) are treated as relative to the bundle root, and the viewer rewrites them (§7.3).

**Known gap.** References built dynamically at runtime, for example `` `img/${name}.png` ``, can't be detected, and neither can files that are only loaded after user interaction. The read-only file list in the dialog lets the user see what will be published. v1 does not add a control to include extra files; that can come later if it matters.

**Endpoint for the dialog**

- `POST /api/v1/artifacts/bundle-preview` returns the root, the entry path, the file list (path and size), and any `missing` references.
- It is read-only and requires that the caller owns the session.

**At publish time**

- The server gets `session_id`, `turn_id` and `entry_path`. It recomputes the bundle itself rather than trusting a file list from the client.
- It validates every path (under the root, no symlinks escaping it) and the per-file and total size limits.
- It downloads each file with `provider.downloadFile`, with bounded concurrency (8).
- Because the server reads the files itself, the recorded `session_id` and `turn_id` provenance can't be forged by the client.

**Ownership and availability**

- The same rules as `download-sandbox-file`: the caller must own the session.
- If the sandbox is gone, the request returns `409 sandbox_unavailable`.

### 6.3 Limits

| Limit                                   | Default | Config                       |
| --------------------------------------- | ------- | ---------------------------- |
| Max size per file                       | 10 MB   | `ARTIFACT_MAX_FILE_BYTES`    |
| Max total size per version              | 50 MB   | `ARTIFACT_MAX_VERSION_BYTES` |
| Max files per version                   | 20      | `ARTIFACT_MAX_FILES`         |
| Max files scanned in the sandbox folder | 2,000   | `ARTIFACT_MAX_LISTED_FILES`  |

Over a limit, the request returns `413 artifact_too_large` with a message naming the limit that was hit.

### 6.4 Versioning

Versions are immutable and numbers are never reused. Publishing a new version works like this:

1. Collect the files and compute each file's `sha256` and the `manifest_sha256`. No transaction is open yet.
2. If `manifest_sha256` equals the latest version's, return that version with `200` and do nothing else. The UI shows "No changes since v4".
3. Generate the new version's ULID and upload every file under `{tenant_id}/{artifact_id}/{artifact_version_id}/{path}`. Still no transaction.
4. In one transaction:
   - lock the `artifact` row (`SELECT … FOR UPDATE` on Postgres; implicit on SQLite);
   - allocate `latest_version + 1`;
   - insert `artifact_version` and its `artifact_file` rows;
   - update `artifact.latest_version` and `updated_at`.
5. If the upload or the transaction fails, delete the version's prefix as a best effort.

This keeps remote I/O out of `withTransaction`, as `packages/trueforge/AGENTS.md` requires. A crash between steps 3 and 4 leaves an orphaned prefix that no row points to. A sweeper is listed in §13.

### 6.5 Permissions (v1)

| Action                                     | Who                                                                            |
| ------------------------------------------ | ------------------------------------------------------------------------------ |
| List or view artifacts, versions and files | Any signed-in user in the tenant                                               |
| Publish a new artifact                     | Any signed-in user who owns the source session                                 |
| Publish a new version                      | The artifact's creator or a tenant admin, who must also own the source session |
| Edit title or description                  | The artifact's creator or a tenant admin                                       |
| Delete an artifact                         | The artifact's creator or a tenant admin                                       |

These checks follow the existing `canEditSchedule` / `hasAdminRole` helpers.

### 6.6 Deletion

1. In a transaction, delete the `artifact` row. Versions and files cascade.
2. After the commit, delete each version's storage prefix. Versions can be on different backends, so this uses the backend recorded on each version. It is best effort; failures are logged and left for the sweeper.

Deleting a session doesn't delete artifacts. The UI shows the session as unavailable.

## 7. Serving and rendering

### 7.1 Why a bundle needs real URLs

The preview panel renders HTML with `iframe srcDoc`. A `srcDoc` document has no base URL, so `./styles.css` can't resolve. The alternatives all break on real pages:

- rewriting references to blob URLs breaks on CSS `url()`, runtime `fetch` and dynamic imports;
- a service worker adds a lot of machinery.

So bundle files are served from real paths, and the iframe loads the entry from there:

```
/artifact-content/<content_token>/<path>
```

### 7.2 Content tokens

The viewer runs in the signed-in SPA. It asks the authenticated API for a content token (`GET /api/v1/artifacts/{artifact_id}/versions/{version}/content-token`).

**What the token is**

- An HMAC-signed, short-lived (1 hour) capability.
- It is bound to `(tenant_id, artifact_version_id)`.

**Why not cookies**

- The iframe is sandboxed without `allow-same-origin`, so its requests come from an opaque origin. Browsers may not send the app's session cookies with them.
- With a token in the URL, subresources work without cookies.
- The page also can't use the viewer's session to call the TrueForge API.

**Signing key**

- `ARTIFACT_CONTENT_SIGNING_KEY` is required in distributed mode so all replicas agree.
- Standalone mode generates a key on first start and persists it in the app data directory.

**Expiry**

- When a token expires, the viewer fetches a new one and reloads the iframe.
- Tokens never appear in shareable links: the link is always `/artifacts/<slug>`.

### 7.3 The content route

This route isn't part of OpenAPI; it is UI plumbing.

**Mounting**

- It is a plain Hono route registered before `mountFrontend`.
- `/artifact-content` is added to `SERVER_PATH_PREFIXES` in `frontend.ts`.

**Request handling**

- Verify the token.
- Normalize `<path>` and look up the `artifact_file` row (404 if missing). `<path>` empty or `/` serves the entry.
- Stream the file from storage.
- For HTML and CSS only, rewrite root-absolute references (`/assets/app.css`, `url(/img/bg.png)`) whose target exists in the bundle so they point under the token prefix. Without this they would resolve against the TrueForge origin root and break. Other references are untouched.

**Headers on every response**

- `Content-Type: <media_type>`
- `X-Content-Type-Options: nosniff`
- `Content-Security-Policy: sandbox allow-scripts allow-forms; default-src 'self' data: blob: https:; frame-ancestors 'self'`

  The `sandbox` directive is the key protection: even if someone opens a content URL as a top-level page, it runs with an opaque origin and can't read TrueForge cookies, storage or API responses. `frame-ancestors 'self'` stops other sites from embedding artifacts.

- `Referrer-Policy: no-referrer`, so the token doesn't leak to third-party CDNs.
- `Cache-Control: private, max-age=3600`. Bodies are immutable, but tokens rotate.

Content is served on the TrueForge origin. A separate content domain is not part of v1; the iframe sandbox and the `CSP: sandbox` header are the isolation.

### 7.4 Rendering in the viewer

| File kind                     | Rendering                                                                                                                                                                                                  |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HTML                          | `<iframe sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer" src="/artifact-content/<token>/<path>">`. These are the preview panel's sandbox flags, now loaded from a URL instead of `srcDoc` |
| Markdown                      | Fetched as text and rendered with the `Markdown` slot. Relative `img` sources are rewritten to content URLs, and relative `.md` links switch the selected file                                             |
| Images                        | `<img src="/artifact-content/<token>/<path>">`                                                                                                                                                             |
| CSV                           | Parsed client-side into a table, capped at the first 1,000 rows                                                                                                                                            |
| Other text (CSS, JS, JSON, …) | The preview panel's syntax-highlighted text view                                                                                                                                                           |
| Binary / unknown              | Name, size and a download button                                                                                                                                                                           |

- The `html` and `markdown` branches of `FilePreviewPanel` are extracted into a shared renderer that takes either `srcDoc` text or a URL, so the preview panel and the viewer stay identical.
- **Download** uses `GET /api/v1/artifacts/{artifact_id}/versions/{version}/download`. For bundles it streams a zip with `archiver` (a new dependency of `packages/trueforge`); for a single file it returns that file. Both are sent with `Content-Disposition: attachment`. The zip is built while streaming from storage, so the server does not hold the whole bundle in memory.

### 7.5 Base path

- `url` fields in API responses are absolute. They are built from `PUBLIC_BASE_URL` plus the UI base path (`getPublicUiBasePath()`).
- Content URLs use the same host and UI base path as the rest of the app.

### 7.6 How this compares to S3 static website hosting

An S3 static website works because the URL path maps straight onto the object key. `/site/index.html` loads `site/styles.css` for `./styles.css`, `Content-Type` comes from object metadata, and a folder URL serves `index.html`. The content route does the same job: the token prefix plays the role of the bucket/folder, and `{prefix}/{path}` is the object key.

TrueForge doesn't use the S3 website endpoint directly, for these reasons:

- It only serves public objects, over HTTP, with no auth. Artifacts need sign-in.
- Presigned URLs don't help: the signature is in the query string, and relative references like `./styles.css` drop it.
- It doesn't work for local disk, and it doesn't add the CSP sandbox headers (§7.3).

So the server proxies each file after verifying a token, on the TrueForge origin. The static-site-shaped key layout (§8.1) keeps a later swap open: a deployment could put a CDN in front of the same prefixes without a data migration. That is not part of v1. With a 20-file cap, the extra hop per file is fine.

## 8. Storage

### 8.1 Interface

The interface lives in `packages/trueforge/src/artifacts/storage/` and is server-only.

```ts
interface ArtifactBlobStorage {
  readonly backend: ArtifactStorageBackend; // 'local' | 's3'
  /** Returns the fully qualified prefix that holds the version. */
  resolvePrefix(input: { key: string }): string;
  put(input: { prefix: string; path: string; body: Buffer; mediaType: string }): Promise<void>;
  get(input: { prefix: string; path: string }): Promise<NodeJS.ReadableStream>;
  deletePrefix(input: { prefix: string }): Promise<void>;
}
```

- **Key layout:** `{tenant_id}/{artifact_id}/{artifact_version_id}/{path}`. A version is one directory tree, so the layout is the same on local disk and S3.
- The layout is deliberately static-site shaped. A CDN or static file server could serve a version's prefix directly in the future (§7.6) without a data migration.
- A registry built at startup maps `backend` to an adapter:
  - reads use the version's `storage_backend`;
  - writes use the configured default.

### 8.2 Adapters

**`local`**

- `storage_location` is the version's directory relative to the configured root, so moving the data directory doesn't break existing rows.
- Writes go to a temp file and are then renamed, so they are atomic.
- Path traversal is guarded.
- Default root: `{appDataDir}/artifacts`.

**`s3`**

- `storage_location` is `s3://<bucket>/<prefix><key>/`, the version's prefix. The full bucket is stored so that changing the config later doesn't orphan old rows.
- Uses `@aws-sdk/client-s3` (a new dependency) with the default credential chain.
- `endpoint` and `forcePathStyle` support MinIO, R2 and Ceph.

### 8.3 Configuration (`packages/trueforge/src/config.ts`)

| Env var                        | Default                      | Notes                             |
| ------------------------------ | ---------------------------- | --------------------------------- |
| `ARTIFACT_STORAGE_BACKEND`     | `local`                      | Backend for new writes            |
| `ARTIFACT_STORAGE_LOCAL_DIR`   | `{appDataDir}/artifacts`     |                                   |
| `ARTIFACT_S3_BUCKET`           | —                            | Required when the backend is `s3` |
| `ARTIFACT_S3_PREFIX`           | `artifacts/`                 |                                   |
| `ARTIFACT_S3_REGION`           | —                            | Falls back to SDK resolution      |
| `ARTIFACT_S3_ENDPOINT`         | —                            | For S3-compatible stores          |
| `ARTIFACT_S3_FORCE_PATH_STYLE` | `false`                      |                                   |
| `ARTIFACT_CONTENT_SIGNING_KEY` | generated in standalone mode | Required in distributed mode      |
| `ARTIFACT_MAX_*`               | see §6.3                     |                                   |

**Startup and read rules**

- **Distributed mode** fails at startup if the backend is `local` and `ARTIFACT_STORAGE_LOCAL_DIR` isn't set explicitly. Setting it explicitly signals that it is a shared volume; otherwise replicas would return 404s for each other's files.
- An adapter is registered for reads whenever its config is present, even when it isn't the write backend. This allows switching from `local` to `s3` without losing old versions.

**Deployment config**

- Update the Helm chart (env vars, plus an optional PVC for `local`).
- Update `docker-compose.yml` (a volume for `local`).

## 9. API

All routes are under `/api/v1/artifacts` and require auth. Fern group: `artifacts`. The wire format is snake_case with `{ data }` envelopes, following `packages/trueforge/AGENTS.md`.

| Method & path                                                          | Request                                                                                            | Response                                                             | Fern method         |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------- |
| `GET /api/v1/artifacts`                                                | `ListArtifactsRequestQuery`: `slug?`, `session_id?`, `created_by_me?`, `q?`, `limit`, `page_token` | `ListArtifactsResponse`                                              | `list`              |
| `POST /api/v1/artifacts/bundle-preview`                                | `PreviewArtifactBundleRequest`: `session_id`, `turn_id`, `entry_path`, `root?`                     | `PreviewArtifactBundleResponse`                                      | `preview_bundle`    |
| `POST /api/v1/artifacts`                                               | `CreateArtifactRequest`: `title`, `slug?`, `description?`, `note?`, `source`                       | **201** `GetArtifactResponse`                                        | `create`            |
| `GET /api/v1/artifacts/{artifact_id}`                                  | —                                                                                                  | `GetArtifactResponse`                                                | `get`               |
| `PUT /api/v1/artifacts/{artifact_id}`                                  | `UpdateArtifactRequest`: `title`, `description?`                                                   | `GetArtifactResponse`                                                | `update`            |
| `DELETE /api/v1/artifacts/{artifact_id}`                               | —                                                                                                  | `DeleteArtifactResponse` (`{}`)                                      | `delete`            |
| `GET /api/v1/artifacts/{artifact_id}/versions`                         | `limit`, `page_token`                                                                              | `ListArtifactVersionsResponse`                                       | `list_versions`     |
| `POST /api/v1/artifacts/{artifact_id}/versions`                        | `CreateArtifactVersionRequest`: `source`, `note?`                                                  | **201** `GetArtifactVersionResponse` (`200` when deduplicated)       | `create_version`    |
| `GET /api/v1/artifacts/{artifact_id}/versions/{version}`               | —                                                                                                  | `GetArtifactVersionResponse` (includes `files`)                      | `get_version`       |
| `GET /api/v1/artifacts/{artifact_id}/versions/{version}/content-token` | —                                                                                                  | `GetArtifactContentTokenResponse`: `token`, `base_url`, `expires_at` | `get_content_token` |
| `GET /api/v1/artifacts/{artifact_id}/versions/{version}/download`      | —                                                                                                  | bytes (file or zip)                                                  | `download_version`  |

**Source.** `source` is the named schema `ArtifactBundleSource`: `{ session_id, turn_id, entry_path }`. The server computes the bundle (§6.2). It has a single shape today, so it isn't a union; it can become a `z.discriminatedUnion('type', …)` when other sources are added.

**Slug lookup.** Slugs are looked up with `GET /api/v1/artifacts?slug=<slug>`, which returns zero or one result. That way id-keyed and name-keyed operations aren't mixed on one resource.

**Wire shapes** (each nested object is a named schema):

```jsonc
// Artifact
{
  "id": "01J…", "slug": "q3-revenue-report", "title": "Q3 revenue report", "description": null,
  "url": "https://forge.acme.com/artifacts/q3-revenue-report",
  "latest_version": { /* ArtifactVersionSummary */ },
  "created_by": { "id": "…", "type": "user", "display_name": "Priya Raman" },
  "created_at": "…", "updated_at": "…"
}

// ArtifactVersion (ArtifactVersionSummary omits `files`)
{
  "artifact_id": "01J…", "version": 4, "note": "Fixed APAC numbers",
  "entry_path": "index.html", "entry_content_type": "html",
  "file_count": 6, "total_size_bytes": 392211,
  "session_id": "…", "turn_id": "…", "source_root": "/workspace/report",
  "storage_backend": "s3",
  "created_by": { /* Subject */ }, "created_at": "…",
  "files": [{ "path": "styles.css", "size_bytes": 6144, "media_type": "text/css", "sha256": "…" }]
}
```

`storage_location` stays internal and doesn't appear on the wire.

**Errors**

- `404` not found
- `409` `slug_taken` / `sandbox_unavailable`
- `413` `artifact_too_large`
- `422` `invalid_slug` / `unsupported_content_type` / `invalid_path`
- `403` not the creator or an admin, or not the session owner

The generated SDKs and OpenAPI JSON are regenerated by CI.

## 10. Frontend architecture

**Port**

- `ArtifactServer` in `assistant-ui-runtime/src/server/types.ts`, exposed as an optional `artifacts?: ArtifactServer` on `AgentUIServerPort`. If the port is omitted, the sidebar entry, the Publish button and the routes are hidden.
- Methods: `listArtifacts`, `getArtifact`, `previewBundle`, `createArtifact`, `updateArtifact`, `deleteArtifact`, `listVersions`, `getVersion`, `createVersion`, `getContentToken`, `downloadVersion`.

**Adapter**

- `trueforge-ui/src/plugins/trueforge-agent-server-adapter/artifacts/artifactServer.ts`, wired in `createTrueForgeAgentUIServer`.

**Routing**

- Add the places `artifacts` (`/artifacts`) and `artifactViewer` (`/artifacts/:slug`) to `RoutePlace`, `RoutesConfig`, `DEFAULTS`, `buildPath`, `matchPath`, `derivePlace` and `toEffectiveRoutes`.
- The viewer renders outside `SidebarLayout`'s chrome, and `?version=` is read from the query string.

**Shared renderer**

- Extract the `html` and `markdown` rendering from `FilePreviewPanel` into one component that accepts either text (`srcDoc`) or a content URL.

**New atoms**

- All slotted: registered in `defaultSlots` and consumed via `useSlot`.
- `ArtifactsButton`, `ArtifactsPage`, `ArtifactRow`, `ArtifactVersionsList`, `ArtifactViewerPage`, `ArtifactFileTree`, `PublishArtifactDialog`, `BundleSummary`.
- Tables, selects, checkboxes and dialogs come from `src/atoms/primitives/`. A generic file-tree primitive goes there too, because the viewer and the publish dialog both use it.

**Analytics events**

- `Artifact.PUBLISH_DIALOG_OPENED`
- `Artifact.PUBLISHED`, with `{ mode, entry_content_type, file_count }`
- `Artifact.PAGE_OPENED`
- `Artifact.VIEWER_OPENED`
- `Artifact.LINK_COPIED`
- `Artifact.SESSION_OPENED`
- `Artifact.FILE_SELECTED`
- `Artifact.DOWNLOADED`
- `Artifact.DELETED`

## 11. Security summary

- AI-generated HTML never runs with the TrueForge origin's privileges:
  - in the viewer, it runs in an `iframe sandbox` without `allow-same-origin`;
  - when a content URL is opened directly, the `CSP: sandbox` response header gives the same isolation.
- Content access needs a short-lived token that only signed-in users of the tenant can obtain. Tokens never appear in shareable links, and `no-referrer` stops them leaking to CDNs.
- Paths are normalized and validated on both publish and serve:
  - no `..` segments or absolute paths;
  - symlinks under the bundle root are resolved and rejected if they escape it;
  - the content route only serves paths that exist in `artifact_file`.
- `nosniff` plus the media type stored at publish time prevents content-type confusion.
- v1 serves artifact content on the TrueForge origin. The iframe sandbox and the `CSP: sandbox` header are what keep that HTML away from the app's cookies and API. A separate content domain is future work.

## 12. Testing

**Store contract suites (`trueforge`)**

- Cover `artifact`, `artifact_version` and `artifact_file` on both backends.
- Keep the CI store-test filters in sync.

**Storage adapters**

- Local adapter: unit tests, including traversal and atomic writes.
- S3 adapter: tests against a mocked client.

**API tests**

- Slug validation and conflicts, and autogeneration.
- Bundle preview reference detection: HTML, CSS `@import` and `url()`, markdown, and the outside-root case.
- Limits.
- Dedup on identical republish, version numbering under concurrency, and permissions.
- Deletion freeing the slug.

**Content route**

- Token verification and expiry, the CSP and `nosniff` headers, unknown paths, path traversal, and the entry fallback.

**`listSandboxFiles` (`trueforge-core`)**

- Tested against the local sandbox provider.

**UI (`trueforge-ui`)**

- Publish dialog states (summary, read-only file list, missing-file warning), the artifacts list's expand and row click, and the viewer's version banner and file switching.

## 13. Future work

- Access control: per-artifact visibility and grants, reusing the `access_control` table and the session share dialog.
- A separate content origin, and links that work without signing in, optionally expiring.
- Publishing from an agent tool or from assistant messages.
- A control to add files the automatic scan missed.
- Slug rename with redirects (an `artifact_slug_alias` table).
- GCS and Azure Blob adapters, a storage migration script, and an orphan-blob sweeper.
- Per-version deletion, retention, view counts, and visual diffs between versions.

## 14. Open questions

None. The last review round closed the remaining ones: 20 files per version, the read-only file list is enough, no separate content domain, and `archiver` for zip downloads.

## 15. Implementation plan

Every PR ships with a patch changeset for each published package it touches, ESLint-clean code, and tests in each package's `test/` or `tests/` directory, mirroring `src`.

**Phase 1 — Backend (trueforge, trueforge-core)**

1. Migrations and stores for the three tables, wired into `ServerPersistence` and `scripts/write-openapi.ts`.
2. `ArtifactBlobStorage` with the local and S3 adapters, the registry, config entries and startup validation.
3. `listSandboxFiles` in core, and reference detection and bundle collection in the server.
4. An artifact service (preview, publish, version, delete), plus the routes and schemas.
5. Content tokens, the `/artifact-content` route, and the `frontend.ts` prefix.
6. Helm chart and docker-compose updates, and `docs/artifacts.mdx`.

**Phase 2 — UI (assistant-ui-runtime, trueforge-ui)**
After CI has regenerated the SDK:

1. The port and adapter.
2. The shared renderer extraction and the file-tree primitive.
3. The publish dialog in the preview panel.
4. The Artifacts page and sidebar entry.
5. The viewer with the file browser.
6. Analytics events.
7. Tests.
