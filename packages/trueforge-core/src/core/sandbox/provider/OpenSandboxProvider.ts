/**
 * OpenSandboxProvider — SandboxProvider implementation backed by
 * @alibaba-group/opensandbox (https://github.com/opensandbox-group/OpenSandbox).
 *
 * This was written against the SDK's real .d.ts files (v0.x, installed and inspected
 * directly — the README alone doesn't cover the API surface this needs), not just the
 * README. Key facts that shape the design below, and things that still need a decision
 * from the team before this ships:
 *
 * 1. NO DAYTONA-STYLE IMAGE BUILD STEP EXISTS.
 *    Daytona's `buildImage()` registers a Dockerfile-built snapshot once and clones it
 *    per sandbox. OpenSandbox has no equivalent — `Sandbox.create({ image })` just pulls
 *    a raw image reference fresh every time. The only snapshot primitive is
 *    `SandboxManager.createSnapshot(sandboxId, { name })`, which checkpoints an *already
 *    running* sandbox's filesystem — it's a VM-style snapshot, not a build pipeline.
 *
 *    To get Daytona-equivalent behavior (build once, clone many, observable build
 *    status), this provider spins up one throwaway sandbox from the raw image and
 *    snapshots it under a deterministic name derived from the image digest, then has
 *    `createSandbox()` clone from that snapshot instead of the raw image.
 *
 *    OPEN QUESTION / RISK: unlike Daytona's snapshot-registration POST (which 409s on a
 *    duplicate name so concurrent replicas converge safely), `createSnapshot` here has no
 *    documented uniqueness guarantee on `name`. Two replicas racing `buildImage()` at
 *    startup could each create a same-named snapshot. Confirm server-side behavior before
 *    relying on this, or add a distributed lock around the create-throwaway-and-snapshot
 *    step (e.g. a DB advisory lock keyed by the derived build ref).
 *
 * 2. SANDBOX IDS ARE OPAQUE / SERVER-GENERATED — there's no client-chosen `name` field
 *    like Daytona's `${tenantName}.${uuid}`. `validateSandboxOwnedByTenant`'s string-prefix
 *    trick doesn't work here. This provider instead stamps `metadata[TENANT_METADATA_KEY]`
 *    at creation time and re-checks it via `getSandboxInfo` whenever a sandboxId arrives
 *    from outside this process (i.e. on every cache-miss reconnect). This is an extra
 *    round trip Daytona doesn't need — acceptable, but worth knowing about.
 *
 * 3. RECONNECT is `Sandbox.connect({ sandboxId })`; a *paused* sandbox must instead go
 *    through `Sandbox.resume({ sandboxId })` (connect will fail — execd isn't up while
 *    paused). `sandbox.resume()` (instance method) does the same for an in-hand instance
 *    and returns a fresh `Sandbox`, mirroring Daytona's `start()`-then-reuse pattern.
 *
 * 4. ERRORS: every HTTP-level failure is normalized to `SandboxApiException` with a
 *    `statusCode` (confirmed by reading the compiled adapter code, not just the types) —
 *    so `e.statusCode === 404` is exactly the Daytona `DaytonaError.statusCode === 404`
 *    pattern.
 *
 * 5. FILES: `files.getFileInfo([path])` returns `Record<string, FileInfo>` with
 *    `{size, type}` for the pre-download size/dir check; `files.readBytes(path)` returns
 *    a `Uint8Array` (wrap in `Buffer.from`); `files.writeFiles([{path, data}])` accepts a
 *    `Buffer` directly for upload.
 *
 * 6. EXEC: `commands.run(cmd, {workingDirectory, envs, timeoutSeconds})` returns
 *    `{logs: {stdout, stderr}, exitCode}` — there's no single pre-merged "result" string
 *    like Daytona's `response.result`, so it's built here by concatenating stdout then
 *    stderr.
 *
 * 7. CODE MODE / SIGNED ENDPOINTS — THE BIGGEST OPEN QUESTION. Daytona's signed preview
 *    URL embeds an expiring token *in the URL*, so `httpUrlToWsUrl` is all that's needed.
 *    OpenSandbox's `getSignedEndpoint(port, expiresAt)` instead returns
 *    `{ endpoint, headers }` — auth is via **required headers on the handshake**, not a
 *    URL token. `CodeModeTransport.resolveHostUrl` (per DaytonaProvider's usage) only
 *    returns a URL string, with nowhere to plumb headers through. Before enabling
 *    `secureAccess: true` sandboxes with Code Mode, confirm one of:
 *      a) `CodeModeNatsTransport`'s underlying WS client (likely Node's `ws`) can accept
 *         a `headers` option — if so, `resolveHostUrl`'s contract needs extending to
 *         return headers alongside the URL, OR
 *      b) sandboxes created by this provider run with `secureAccess: false` and rely on
 *         network-level isolation (no public exposure of the NATS bridge port) instead.
 *    This draft takes option (b) as the safe default — see `createCodeModeTransport()`.
 *
 * Everything else follows DaytonaProvider's shape closely: a static cache of live
 * `Sandbox` instances keyed by sandboxId, a recovery wrapper that resumes a paused
 * sandbox and retries once, and the same `ExecResult` / error-type contracts the rest
 * of trueforge-core already depends on.
 */

import {
  ConnectionConfig,
  Sandbox,
  SandboxApiException,
  SandboxException,
  SandboxManager,
  type PlatformSpec,
  type SandboxInfo,
} from '@alibaba-group/opensandbox';
import { join } from 'node:path/posix';
import type { Logger } from 'winston';
import { extractErrorLogFields } from '../../util/errorLogFields';
import {
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxNotAvailableError,
  SandboxPathIsDirectoryError,
} from '../SandboxErrors';
import type { CodeModeTransport } from '../codeMode/CodeModeTransport';
import { CodeModeNatsTransport } from '../codeMode/nats/CodeModeNatsTransport';
import { DEFAULT_SANDBOX_NATS_WS_PORT } from '../constants';
import type { ExecResult, SandboxBuild, SandboxExecParams, SandboxFileInfo, SandboxProvider } from './Provider';

const HTTP_STATUS_NOT_FOUND = 404;

/** Metadata key this provider stamps on every sandbox it creates, since OpenSandbox
 *  sandbox ids are opaque server-generated strings with no room for a tenant prefix. */
const TENANT_METADATA_KEY = 'trueforge.tenant';
/** Metadata key recording the release image the sandbox (or its golden snapshot) came from. */
const IMAGE_METADATA_KEY = 'trueforge.image';

const GOLDEN_SNAPSHOT_NAME_PREFIX = 'trueforge-build-';
/** Short-lived: only exists long enough to be snapshotted, then killed. */
const THROWAWAY_SANDBOX_TIMEOUT_SECONDS = 300;

/** Terminal-failure snapshot states: one stuck here never becomes ready on its own. */
function isFailedSnapshotState(state: string): boolean {
  return state === 'Failed';
}

function isReadySnapshotState(state: string): boolean {
  return state === 'Ready';
}

/**
 * The server enforces Kubernetes-label-value syntax on metadata values: alphanumeric/'-'/'_'/'.'
 * only, must start and end alphanumeric, max 63 chars (confirmed directly from the server's
 * SANDBOX::INVALID_METADATA_LABEL error, not just the client types). Raw image references like
 * `registry.example.com/org/image:sha256-...` fail this on both ':' and '/', so anything derived
 * from an image URI must be sanitized before going into `metadata`, not just the tenant name.
 */
function sanitizeMetadataValue(value: string): string {
  const replaced = value.replace(/[^A-Za-z0-9_.-]/g, '_');
  const trimmed = replaced.replace(/^[^A-Za-z0-9]+/, '').replace(/[^A-Za-z0-9]+$/, '');
  const truncated = trimmed.slice(0, 63);
  return truncated.length > 0 ? truncated : 'unknown';
}

/** Digest portion of a container image reference (the tag/digest after the final `:`). */
function imageDigest(image: string): string {
  const lastSegment = image.slice(image.lastIndexOf('/') + 1);
  const colon = lastSegment.lastIndexOf(':');
  if (colon === -1) {
    throw new Error(`Sandbox image reference has no tag/digest: ${image}`);
  }
  return lastSegment.slice(colon + 1);
}

function deriveGoldenSnapshotName(digest: string): string {
  return `${GOLDEN_SNAPSHOT_NAME_PREFIX}${digest}`;
}

export interface OpenSandboxProviderOptions {
  /** Domain (host[:port]) of the OpenSandbox API server, e.g. "api.opensandbox.io". */
  domain: string;
  protocol?: 'http' | 'https';
  apiKey: string;
  tenantName: string;
  /** Release-owned sandbox image reference; snapshotted once into a golden snapshot and cloned per sandbox. */
  sandboxImage: string;
  timeoutMs: number;
  resourceLimits?: Record<string, string>;
  fileMaxBytesForDownload: number;
  /** Defaults to the built-in sandbox NATS WebSocket port. */
  natsBridgePort?: number;
  /**
   * Timeout the SDK applies to each individual HTTP call to the OpenSandbox server —
   * separate from `timeoutMs`, which is the sandbox's own idle/lifetime TTL. The SDK
   * defaults this to 30s (confirmed in its compiled source, not just its docs), which is
   * too tight for `Sandbox.create()` on a large release image: the server call is
   * synchronous through image inspect -> container create -> container start (and, per
   * this deployment's `[egress] mode = "dns"` config, a second sidecar container per
   * sandbox), and running an amd64 image under QEMU emulation on Apple Silicon makes that
   * meaningfully slower still. Defaults to 120s here; raise further if cold sandbox
   * creation still times out on your infra.
   */
  requestTimeoutSeconds?: number;
  /**
   * Target platform (os/arch) sandboxes are provisioned for. IMPORTANT: if omitted, the
   * server defaults to the HOST machine's architecture, not the image's — confirmed by
   * hitting this directly: on an arm64 Mac against an amd64-only release image, sandbox
   * creation from a golden snapshot failed with a registry-pull 404, because the server
   * looked for an arm64 variant of a snapshot that only exists as amd64 (the throwaway
   * container was committed under whatever arch the image actually is). Set this
   * explicitly to match your release image's real architecture — e.g. `{ os: 'linux',
   * arch: 'amd64' }` for a typical CI-built image — rather than relying on the default,
   * which only happens to be correct when the host and image architectures match.
   */
  platform?: PlatformSpec;
  /**
   * Container entrypoint override. IMPORTANT: unlike plain Docker, the OpenSandbox SDK
   * does NOT fall back to the image's own `ENTRYPOINT` when this is omitted — it always
   * sends an explicit override, defaulting to `["tail", "-f", "/dev/null"]` (confirmed in
   * the SDK's own docs). For a release image like trueforge-sandbox, whose real
   * `ENTRYPOINT ["/usr/bin/supervisord", "-n"]` launches supervisord (which in turn
   * autostarts the NATS bridge Code Mode depends on — see `nats.supervisor.conf`), leaving
   * this unset means that real boot command silently never runs, and every sandbox comes
   * up with a bare idle process instead. Confirmed live: without this set, `ps`-equivalent
   * introspection showed only `sh`, `execd`, and `tail -f /dev/null` — no supervisord, no
   * nats-server, nothing listening on the Code Mode bridge port. Set this to match
   * whatever `sandboxImage`'s Dockerfile actually declares as `ENTRYPOINT`.
   */
  entrypoint?: string[];
  logger: Logger;
}

export class OpenSandboxProvider implements SandboxProvider {
  readonly type = 'opensandbox';
  private readonly connectionConfig: ConnectionConfig;
  private readonly manager: SandboxManager;
  private readonly tenantName: string;
  private readonly imageUri: string;
  private readonly timeoutMs: number;
  private readonly resourceLimits: Record<string, string> | undefined;
  private readonly platform: PlatformSpec | undefined;
  private readonly entrypoint: string[] | undefined;
  private readonly fileMaxBytesForDownload: number;
  private readonly natsBridgePort: number;
  private readonly logger: Logger;

  /** Resolved once buildImage()/getImageBuildStatus() sees the golden snapshot as Ready. */
  private readyGoldenSnapshotId: string | undefined;
  /**
   * Throwaway sandboxes are keyed by snapshot name because each API request constructs a fresh
   * provider instance. See the fix note in buildImage()/getImageBuildStatus() — killing one too
   * early races the server's background snapshot commit. Single-process tracking means a process
   * restart can still leak a throwaway until its server-side TTL; multi-replica deployments need
   * this state persisted or coordinated externally.
   */
  private static readonly pendingThrowawaySandboxes = new Map<string, Sandbox>();

  private static readonly cachedSandboxes = new Map<string, Sandbox>();
  // De-dupes concurrent recovery attempts on the same sandbox to a single resume+retry round-trip.
  private static readonly inFlightRecoveries = new Map<string, Promise<Sandbox>>();

  constructor(options: OpenSandboxProviderOptions) {
    this.connectionConfig = new ConnectionConfig({
      domain: options.domain,
      protocol: options.protocol ?? 'https',
      apiKey: options.apiKey,
      requestTimeoutSeconds: options.requestTimeoutSeconds ?? 120,
    });
    this.manager = SandboxManager.create({ connectionConfig: this.connectionConfig });
    this.tenantName = options.tenantName;
    this.imageUri = options.sandboxImage;
    this.timeoutMs = options.timeoutMs;
    this.resourceLimits = options.resourceLimits;
    this.platform = options.platform;
    this.entrypoint = options.entrypoint;
    this.fileMaxBytesForDownload = options.fileMaxBytesForDownload;
    this.natsBridgePort = options.natsBridgePort ?? DEFAULT_SANDBOX_NATS_WS_PORT;
    this.logger = options.logger.child({ module: 'OpenSandboxProvider' });
  }

  // ---------------------------------------------------------------------------------
  // Image "build" (golden snapshot) — see file header, point 1.
  // ---------------------------------------------------------------------------------

  private goldenSnapshotName(): string {
    return deriveGoldenSnapshotName(imageDigest(this.imageUri));
  }

  private async findGoldenSnapshot(name: string) {
    const { items } = await this.manager.listSnapshots({ name });
    // Defensive: `name` filtering is server-side per the SDK types, but if more than one
    // comes back (e.g. a duplicate from the race described in the file header), prefer the
    // most recently created one rather than erroring the whole build-status check.
    return items.length === 0
      ? undefined
      : items.reduce((latest, item) => (item.createdAt > latest.createdAt ? item : latest));
  }

  private toBuild(snapshotId: string | undefined, state: string, reason: string | undefined): SandboxBuild {
    const metadata = { image_uri: this.imageUri, ...(snapshotId ? { snapshot_id: snapshotId } : {}) };
    if (isReadySnapshotState(state)) {
      return { status: 'ready', reason: null, metadata };
    }
    if (isFailedSnapshotState(state)) {
      return { status: 'failed', reason: reason ?? `OpenSandbox golden snapshot build failed (${state}).`, metadata };
    }
    return {
      status: 'pending',
      reason: reason ?? `OpenSandbox golden snapshot build in progress (${state}).`,
      metadata,
    };
  }

  async buildImage(): Promise<SandboxBuild> {
    const name = this.goldenSnapshotName();
    const existing = await this.findGoldenSnapshot(name);

    if (existing) {
      if (isReadySnapshotState(existing.status.state)) {
        this.readyGoldenSnapshotId = existing.id;
        return this.toBuild(existing.id, existing.status.state, existing.status.message);
      }
      if (!isFailedSnapshotState(existing.status.state)) {
        return this.toBuild(existing.id, existing.status.state, existing.status.message);
      }
      // A failed build keeps the deterministic name occupied and never self-heals; drop it
      // and fall through to recreate. Another replica may already have deleted it — fine.
      await this.manager.deleteSnapshot(existing.id).catch((error: unknown) => {
        if (!(error instanceof SandboxApiException) || error.statusCode !== HTTP_STATUS_NOT_FOUND) {
          throw error;
        }
      });
    }

    // TODO(confirm): no documented uniqueness guarantee on snapshot `name` — see file header
    // point 1. If two replicas race here, both will spin up a throwaway sandbox and create a
    // same-named snapshot. Consider wrapping this in a distributed lock keyed by `name`.
    const throwaway = await Sandbox.create({
      connectionConfig: this.connectionConfig,
      image: this.imageUri,
      timeoutSeconds: THROWAWAY_SANDBOX_TIMEOUT_SECONDS,
      metadata: {
        [TENANT_METADATA_KEY]: sanitizeMetadataValue(this.tenantName),
        [IMAGE_METADATA_KEY]: sanitizeMetadataValue(this.imageUri),
      },
      // Must match createFreshSandbox()'s platform: the snapshot is committed from THIS
      // container, so if this one's arch doesn't match what callers later request, every
      // real sandbox creation from the resulting snapshot fails with a registry-pull 404
      // (confirmed live — see the option's doc comment on OpenSandboxProviderOptions).
      ...(this.platform !== undefined && { platform: this.platform }),
    });
    // IMPORTANT (confirmed against a real server, not theoretical): createSnapshot() registers
    // the snapshot and returns quickly with status 'Creating' — the actual `docker commit`
    // against the throwaway's container runs asynchronously afterward. Killing the throwaway
    // here races that background job and fails with `docker.errors.NotFound: ... does not
    // exist` inside the server's `_create_snapshot`. So we deliberately do NOT kill it now;
    // getImageBuildStatus() kills it once polling shows the snapshot has left 'Creating'.
    OpenSandboxProvider.pendingThrowawaySandboxes.set(name, throwaway);
    const snapshot = await this.manager.createSnapshot(throwaway.id, { name });
    return this.toBuild(snapshot.id, snapshot.status.state, snapshot.status.message);
  }

  /** Kills and releases a throwaway build sandbox once its snapshot is done with it (Ready or Failed). */
  private async releasePendingThrowaway(name: string): Promise<void> {
    const throwaway = OpenSandboxProvider.pendingThrowawaySandboxes.get(name);
    if (!throwaway) {
      return;
    }
    OpenSandboxProvider.pendingThrowawaySandboxes.delete(name);
    await throwaway.kill().catch((error: unknown) => {
      this.logger.warn('Failed to kill throwaway sandbox after snapshot completed', extractErrorLogFields(error));
    });
    await throwaway.close().catch(() => undefined);
  }

  async getImageBuildStatus(): Promise<SandboxBuild> {
    const name = this.goldenSnapshotName();
    const existing = await this.findGoldenSnapshot(name);
    if (!existing) {
      return {
        status: 'pending',
        reason: 'OpenSandbox golden snapshot build not started.',
        metadata: { image_uri: this.imageUri },
      };
    }
    if (isReadySnapshotState(existing.status.state) || isFailedSnapshotState(existing.status.state)) {
      // Snapshot has left 'Creating' — the throwaway's container is no longer needed by the
      // server's commit job, so it's now safe to release it (if this process is the one that
      // created it; see the field's doc comment for the multi-replica caveat).
      await this.releasePendingThrowaway(name);
    }
    if (isReadySnapshotState(existing.status.state)) {
      this.readyGoldenSnapshotId = existing.id;
    }
    return this.toBuild(existing.id, existing.status.state, existing.status.message);
  }

  /** Resolves the golden snapshot id, looking it up if we haven't cached one yet. */
  private async resolveGoldenSnapshotId(): Promise<string> {
    if (this.readyGoldenSnapshotId) {
      return this.readyGoldenSnapshotId;
    }
    const build = await this.getImageBuildStatus();
    if (build.status !== 'ready' || !this.readyGoldenSnapshotId) {
      throw new Error(
        `OpenSandbox golden snapshot for image '${this.imageUri}' is not ready (status: ${build.status}). Call buildImage() first.`,
      );
    }
    return this.readyGoldenSnapshotId;
  }

  // ---------------------------------------------------------------------------------
  // Sandbox lifecycle
  // ---------------------------------------------------------------------------------

  private async validateOwnedByTenant(sandboxId: string, info?: SandboxInfo): Promise<void> {
    const sandboxInfo =
      info ??
      (await this.manager.getSandboxInfo(sandboxId).catch((ex: unknown) => {
        if (ex instanceof SandboxApiException && ex.statusCode === HTTP_STATUS_NOT_FOUND) {
          throw new SandboxNotAvailableError(sandboxId);
        }
        throw ex;
      }));
    if (sandboxInfo.metadata?.[TENANT_METADATA_KEY] !== sanitizeMetadataValue(this.tenantName)) {
      // Deliberately reported as "not available" rather than "forbidden" so callers can't
      // use this to probe for the existence of another tenant's sandbox ids.
      throw new SandboxNotAvailableError(sandboxId);
    }
  }

  private async restoreExistingSandbox(sandboxId: string): Promise<Sandbox> {
    let info: SandboxInfo;
    try {
      info = await this.manager.getSandboxInfo(sandboxId);
    } catch (ex) {
      if (ex instanceof SandboxApiException && ex.statusCode === HTTP_STATUS_NOT_FOUND) {
        throw new SandboxNotAvailableError(sandboxId);
      }
      throw ex;
    }
    await this.validateOwnedByTenant(sandboxId, info);

    if (info.status.state === 'Paused') {
      return Sandbox.resume({ sandboxId, connectionConfig: this.connectionConfig });
    }
    return Sandbox.connect({ sandboxId, connectionConfig: this.connectionConfig });
  }

  private async getOrCreateSandbox(sandboxId?: string): Promise<Sandbox> {
    if (sandboxId) {
      const cached = OpenSandboxProvider.cachedSandboxes.get(sandboxId);
      if (cached) {
        return cached;
      }
    }

    const sandbox = sandboxId ? await this.restoreExistingSandbox(sandboxId) : await this.createFreshSandbox();
    OpenSandboxProvider.cachedSandboxes.set(sandbox.id, sandbox);
    return sandbox;
  }

  private async createFreshSandbox(): Promise<Sandbox> {
    const snapshotId = await this.resolveGoldenSnapshotId();
    return Sandbox.create({
      connectionConfig: this.connectionConfig,
      snapshotId,
      // Conditional spread rather than `resource: this.resourceLimits` — with
      // exactOptionalPropertyTypes, an optional property must be *absent* when there's no
      // value, not present-and-set-to-undefined.
      ...(this.resourceLimits !== undefined && { resource: this.resourceLimits }),
      ...(this.platform !== undefined && { platform: this.platform }),
      ...(this.entrypoint !== undefined && { entrypoint: this.entrypoint }),
      metadata: {
        [TENANT_METADATA_KEY]: sanitizeMetadataValue(this.tenantName),
        [IMAGE_METADATA_KEY]: sanitizeMetadataValue(this.imageUri),
      },
      // See file header point 7 — kept unsigned/no header-auth requirement for now.
      secureAccess: false,
    });
  }

  // Resumes a paused sandbox and returns the fresh instance; returns the same instance
  // unchanged if it's already running. De-dupes concurrent callers on the same sandboxId.
  private static async recoverSandbox(sandboxId: string, cached: Sandbox): Promise<Sandbox> {
    const existing = OpenSandboxProvider.inFlightRecoveries.get(sandboxId);
    if (existing) {
      return existing;
    }

    const recovery = (async () => {
      const info = await cached.getInfo();
      if (info.status.state === 'Running') {
        return cached;
      }
      // resume() throws on unrecoverable states — per the server's documented lifecycle
      // (Pending -> Running -> Paused/Resuming -> Stopping -> Terminated/Failed), a sandbox
      // that's Terminated, Failed, or already Stopping can't be resumed; let it propagate.
      return cached.resume();
    })().finally(() => {
      OpenSandboxProvider.inFlightRecoveries.delete(sandboxId);
    });

    OpenSandboxProvider.inFlightRecoveries.set(sandboxId, recovery);
    return recovery;
  }

  private async executeWithSandboxRecovery<T>(
    sandboxId: string,
    operation: (sandbox: Sandbox) => Promise<T>,
  ): Promise<T> {
    const sandbox = await this.getOrCreateSandbox(sandboxId);
    try {
      return await operation(sandbox);
    } catch (originalError) {
      if (!(originalError instanceof SandboxException)) {
        throw originalError;
      }

      let recovered: Sandbox;
      try {
        recovered = await OpenSandboxProvider.recoverSandbox(sandboxId, sandbox);
      } catch (recoveryError) {
        this.logger.error('Sandbox recovery failed', {
          ...extractErrorLogFields(recoveryError),
          originalError: extractErrorLogFields(originalError),
        });
        throw new Error('Sandbox is unavailable; recovery attempt failed.', { cause: recoveryError });
      }

      if (recovered === sandbox) {
        // Already running — recovery wasn't the fix, so the original error is genuine.
        throw originalError;
      }

      OpenSandboxProvider.cachedSandboxes.set(sandboxId, recovered);
      try {
        return await operation(recovered);
      } catch (retryError) {
        this.logger.error('Sandbox operation failed after successful recovery', {
          ...extractErrorLogFields(retryError),
          originalError: extractErrorLogFields(originalError),
        });
        throw retryError;
      }
    }
  }

  async createSandbox(): Promise<{ sandboxId: string }> {
    const sandbox = await this.createFreshSandbox();
    OpenSandboxProvider.cachedSandboxes.set(sandbox.id, sandbox);
    this.logger.debug(`Sandbox created: id=${sandbox.id}`);
    return { sandboxId: sandbox.id };
  }

  // ---------------------------------------------------------------------------------
  // Exec
  // ---------------------------------------------------------------------------------

  async exec(params: SandboxExecParams): Promise<ExecResult> {
    try {
      return await this.executeWithSandboxRecovery(params.sandboxId, async sandbox => {
        const execution = await sandbox.commands.run(params.command, {
          // Conditional spreads rather than `workingDirectory: params.cwd` etc — with
          // exactOptionalPropertyTypes, RunCommandOpts's optional fields must be *absent*
          // when there's no value, not present-and-set-to-undefined.
          ...(params.cwd !== undefined && { workingDirectory: params.cwd }),
          ...(params.env !== undefined && { envs: params.env }),
          timeoutSeconds: params.timeoutSeconds ?? Math.ceil(this.timeoutMs / 1000),
        });
        const stdout = execution.logs.stdout.map(m => m.text).join('');
        const stderr = execution.logs.stderr.map(m => m.text).join('');
        const result = stderr ? `${stdout}${stdout && '\n'}${stderr}` : stdout;
        // exitCode is nullable in the SDK types (e.g. an execution the server never
        // completed); treat a missing exit code as failure rather than silently
        // reporting success — TODO(confirm): check with the OpenSandbox team when
        // exitCode can legitimately be null for a foreground (non-backgrounded) run.
        return {
          success: true,
          response: { exitCode: execution.exitCode ?? 1, result },
        };
      });
    } catch (e: unknown) {
      OpenSandboxProvider.cachedSandboxes.delete(params.sandboxId);
      if (e instanceof SandboxNotAvailableError) {
        throw e;
      }
      this.logger.error('Sandbox execution error', extractErrorLogFields(e));
      const message = e instanceof Error ? e.message : 'Unknown error';
      return { success: false, error: message };
    }
  }

  // ---------------------------------------------------------------------------------
  // Files
  // ---------------------------------------------------------------------------------

  private async getFileInfo(sandbox: Sandbox, path: string): Promise<SandboxFileInfo> {
    const infoByPath = await sandbox.files.getFileInfo([path]);
    // Defensive: don't assume the response key matches `path` byte-for-byte (e.g. trailing
    // slash normalization) — fall back to the single entry if there's exactly one.
    const info = infoByPath[path] ?? Object.values(infoByPath)[0];
    if (!info) {
      throw new SandboxFileNotFoundError(path);
    }
    return { size: info.size ?? 0, isDir: info.type === 'directory' };
  }

  async downloadFile(params: { sandboxId: string; path: string }): Promise<Buffer> {
    try {
      return await this.executeWithSandboxRecovery(params.sandboxId, async sandbox => {
        const info = await this.getFileInfo(sandbox, params.path);
        if (info.isDir) {
          throw new SandboxPathIsDirectoryError(params.path);
        }
        if (info.size > this.fileMaxBytesForDownload) {
          throw new SandboxFileTooLargeError(params.path, info.size, this.fileMaxBytesForDownload);
        }
        const bytes = await sandbox.files.readBytes(params.path);
        return Buffer.from(bytes);
      });
    } catch (e: unknown) {
      if (
        e instanceof SandboxPathIsDirectoryError ||
        e instanceof SandboxFileTooLargeError ||
        e instanceof SandboxFileNotFoundError
      ) {
        throw e;
      }
      if (e instanceof SandboxApiException && e.statusCode === HTTP_STATUS_NOT_FOUND) {
        throw new SandboxFileNotFoundError(params.path);
      }
      OpenSandboxProvider.cachedSandboxes.delete(params.sandboxId);
      throw e;
    }
  }

  async uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void> {
    try {
      await this.executeWithSandboxRecovery(params.sandboxId, async sandbox => {
        await sandbox.files.writeFiles([{ path: params.remotePath, data: params.content }]);
      });
    } catch (e: unknown) {
      OpenSandboxProvider.cachedSandboxes.delete(params.sandboxId);
      throw e;
    }
  }

  // ---------------------------------------------------------------------------------
  // Code Mode — see file header point 7 before enabling secureAccess on these sandboxes.
  // ---------------------------------------------------------------------------------

  createCodeModeTransport(): CodeModeTransport {
    return new CodeModeNatsTransport({
      resolveHostUrl: async (sandboxId: string) =>
        this.executeWithSandboxRecovery(sandboxId, async sandbox => {
          // Unsigned endpoint: sandboxes are created with `secureAccess: false`, so no
          // header-based token is required here. If that changes, this transport contract
          // needs to grow to carry `Endpoint.headers` through to the WS handshake.
          const { endpoint } = await sandbox.getEndpoint(this.natsBridgePort);
          const scheme = this.connectionConfig.protocol === 'https' ? 'wss' : 'ws';
          return `${scheme}://${endpoint}`;
        }),
      sandboxClientNatsUrl: `ws://localhost:${String(this.natsBridgePort)}`,
      logger: this.logger,
      mcpClientInstall: {
        remotePath: join('/opt', 'tf', 'mcp-client', 'mcp_client.py'),
        pathBinSymlink: join('/usr', 'local', 'bin', 'mcp-client'),
      },
    });
  }

  getAdditionalInstructions(): string | undefined {
    return undefined;
  }

  // Assumes the OpenSandbox-compatible release image uses the same absolute layout as
  // the Daytona image. If OpenSandbox sandboxes are built from a different base image,
  // these need their own paths.
  getToolResultDumpDir(): string {
    return join('/opt', 'tf', 'tool-results');
  }

  getGitCredentialsPath(): string {
    return join('/opt', 'tf', '.git-credentials');
  }

  getFileUploadsDir(): string {
    return join('/opt', 'tf', 'uploads');
  }

  getSkillsDir(): string {
    return join('/opt', 'tf', 'skills');
  }

  getGitDownloaderPath(): string {
    return join('/opt', 'tf', 'git_downloader.py');
  }
}
