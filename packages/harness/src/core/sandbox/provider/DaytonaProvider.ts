import type { Sandbox } from '@daytona/sdk';
import { Daytona, DaytonaError } from '@daytona/sdk';
import { context } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import { randomUUID } from 'crypto';
import type { Logger } from 'winston';
import { extractErrorLogFields } from '../../util/errorLogFields';
import {
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxNotAvailableError,
  SandboxPathIsDirectoryError,
} from '../SandboxErrors';
import { DEFAULT_PREVIEW_URL_EXPIRY_SECONDS, DEFAULT_SANDBOX_NATS_WS_PORT } from '../constants';
import type {
  ExecResult,
  SandboxBuild,
  SandboxBuildMetadata,
  SandboxExecParams,
  SandboxFileInfo,
  SandboxProvider,
} from './Provider';

const SANDBOX_NOT_FOUND_STATUS = 404;
const SANDBOX_STATE_STARTED = 'started';

const BUILD_STATE_ACTIVE = 'active';
const BUILD_STATE_INACTIVE = 'inactive';
const BUILD_STATE_ERROR = 'error';
const BUILD_STATE_BUILD_FAILED = 'build_failed';

const IMAGE_BUILD_NAME_PREFIX = 'trueforge-snapshot-';

// The SDK does not export its branded `Snapshot` type; derive it from the client surface.
type DaytonaSnapshot = Awaited<ReturnType<Daytona['snapshot']['get']>>;

/**
 * Tag portion of a container image reference. Isolates the final path segment first so a
 * registry port (`host:5000/repo`) is never mistaken for the tag; falls back to `latest`
 * when the reference carries no explicit tag.
 */
function imageTag(image: string): string {
  const lastSegment = image.slice(image.lastIndexOf('/') + 1);
  const colon = lastSegment.lastIndexOf(':');
  return colon === -1 ? 'latest' : lastSegment.slice(colon + 1);
}

/** Deterministic build name per image tag so every server replica converges on one build. */
function deriveImageBuildName(tag: string): string {
  return `${IMAGE_BUILD_NAME_PREFIX}${tag}`;
}

/** Terminal-failure build states: a build stuck here never becomes ready on its own. */
function isFailedBuildState(state: DaytonaSnapshot['state']): boolean {
  return state === BUILD_STATE_ERROR || state === BUILD_STATE_BUILD_FAILED;
}

/** Convert Daytona https preview URLs to wss for the NATS client. */
function httpUrlToWsUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === 'https:') parsed.protocol = 'wss:';
  else if (parsed.protocol === 'http:') parsed.protocol = 'ws:';
  return parsed.toString();
}

export interface DaytonaSandboxProviderOptions {
  /** Caller-owned Daytona SDK client (credentials / lifetime). */
  client: Daytona;
  tenantName: string;
  /** Release-owned sandbox image reference; built into a Daytona snapshot and cloned per sandbox. */
  sandboxImage: string;
  timeoutMs: number;
  autoStopIntervalInMinutes: number;
  autoArchiveIntervalInMinutes: number;
  autoDeleteIntervalInMinutes: number;
  fileMaxBytesForDownload: number;
  /** Defaults to the built-in sandbox NATS WebSocket port (4444). */
  natsBridgePort?: number;
  /** Defaults to 1 hour (same as the gateway's max agent execution time). */
  previewUrlExpirySeconds?: number;
  logger: Logger;
}

export class DaytonaSandboxProvider implements SandboxProvider {
  private readonly tenantName: string;
  /** Release-owned sandbox image reference; built into a Daytona snapshot and cloned per sandbox. */
  private readonly sandboxImage: string;
  /** Tag portion of the release image. */
  private readonly imageTag: string;
  /** Daytona snapshot name derived from the image tag; sandboxes are cloned from it. */
  private readonly buildRef: string;
  private readonly timeoutMs: number;
  private readonly autoStopIntervalInMinutes: number;
  private readonly autoArchiveIntervalInMinutes: number;
  private readonly autoDeleteIntervalInMinutes: number;
  private readonly fileMaxBytesForDownload: number;
  private readonly natsBridgePort: number;
  private readonly previewUrlExpirySeconds: number;
  private readonly logger: Logger;
  private readonly daytona: Daytona;
  private static readonly cachedSandboxes = new Map<string, { sandbox: Sandbox; defaultTimeoutMs: number }>();
  // De-dupes concurrent recovery attempts on the same sandbox to a single refreshData+start round-trip.
  private static readonly inFlightRecoveries = new Map<string, Promise<boolean>>();
  // De-dupes concurrent buildImage() calls for the same build so only one delete/create round-trip runs.
  private static readonly inFlightBuilds = new Map<string, Promise<SandboxBuild>>();

  constructor(options: DaytonaSandboxProviderOptions) {
    this.daytona = options.client;
    this.tenantName = options.tenantName;
    this.sandboxImage = options.sandboxImage;
    this.imageTag = imageTag(options.sandboxImage);
    this.buildRef = deriveImageBuildName(this.imageTag);
    this.timeoutMs = options.timeoutMs;
    this.autoStopIntervalInMinutes = options.autoStopIntervalInMinutes;
    this.autoArchiveIntervalInMinutes = options.autoArchiveIntervalInMinutes;
    this.autoDeleteIntervalInMinutes = options.autoDeleteIntervalInMinutes;
    this.fileMaxBytesForDownload = options.fileMaxBytesForDownload;
    this.natsBridgePort = options.natsBridgePort ?? DEFAULT_SANDBOX_NATS_WS_PORT;
    this.previewUrlExpirySeconds = options.previewUrlExpirySeconds ?? DEFAULT_PREVIEW_URL_EXPIRY_SECONDS;
    this.logger = options.logger.child({ module: 'DaytonaProvider' });
  }

  private async getOrCreateSandbox(sandboxId?: string): Promise<{ sandbox: Sandbox; defaultTimeoutMs: number }> {
    if (sandboxId) {
      const cached = DaytonaSandboxProvider.cachedSandboxes.get(sandboxId);
      if (cached) return cached;
    }

    const sandbox = sandboxId
      ? await this.restoreExistingSandbox(sandboxId)
      : await this.daytona.create({
          name: `${this.tenantName}.${randomUUID()}`,
          snapshot: this.buildRef,
          autoStopInterval: this.autoStopIntervalInMinutes,
          autoArchiveInterval: this.autoArchiveIntervalInMinutes,
          autoDeleteInterval: this.autoDeleteIntervalInMinutes,
        });

    const entry = { sandbox, defaultTimeoutMs: this.timeoutMs };
    DaytonaSandboxProvider.cachedSandboxes.set(sandbox.name, entry);
    return entry;
  }

  // Returns true iff the caller should retry: either we restarted a stopped sandbox, or the cache entry is missing and the retry will rebuild it via the cold path.
  private static recoverSandboxIfStopped(sandboxId: string): Promise<boolean> {
    const existing = DaytonaSandboxProvider.inFlightRecoveries.get(sandboxId);
    if (existing) return existing;

    const cached = DaytonaSandboxProvider.cachedSandboxes.get(sandboxId);
    // Cache may have been evicted by a concurrent error path; signal retry so getOrCreateSandbox rebuilds via restoreExistingSandbox.
    if (!cached) return Promise.resolve(true);

    const recovery = (async () => {
      await cached.sandbox.refreshData();
      if (cached.sandbox.state === SANDBOX_STATE_STARTED) return false;
      // start() covers both stopped and archived per Daytona; throws on unrecoverable states (error/destroyed).
      await cached.sandbox.start();
      return true;
    })().finally(() => {
      DaytonaSandboxProvider.inFlightRecoveries.delete(sandboxId);
    });

    DaytonaSandboxProvider.inFlightRecoveries.set(sandboxId, recovery);
    return recovery;
  }

  private async executeWithSandboxRecovery<T>(sandboxId: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (originalError) {
      // TODO: Narrow to a specific Daytona error code once @daytona/sdk exposes one for "sandbox not running".
      if (!(originalError instanceof DaytonaError)) throw originalError;

      let recovered: boolean;
      try {
        recovered = await DaytonaSandboxProvider.recoverSandboxIfStopped(sandboxId);
      } catch (recoveryError) {
        this.logger.error('Sandbox recovery failed', {
          ...extractErrorLogFields(recoveryError),
          originalError: extractErrorLogFields(originalError),
        });
        throw new Error('Sandbox is unavailable; recovery attempt failed.', { cause: recoveryError });
      }

      if (!recovered) throw originalError;

      try {
        return await operation();
      } catch (retryError) {
        this.logger.error('Sandbox operation failed after successful recovery', {
          ...extractErrorLogFields(retryError),
          originalError: extractErrorLogFields(originalError),
        });
        // Rethrow as-is so callers can match domain error types (SandboxPathIsDirectoryError, DaytonaError statusCode mappings, etc.).
        throw retryError;
      }
    }
  }

  private async restoreExistingSandbox(sandboxId: string): Promise<Sandbox> {
    try {
      const sandbox = await this.daytona.get(sandboxId);
      if (sandbox.state !== SANDBOX_STATE_STARTED) {
        await sandbox.start();
      }
      return sandbox;
    } catch (ex) {
      if (ex instanceof DaytonaError && ex.statusCode === SANDBOX_NOT_FOUND_STATUS) {
        throw new SandboxNotAvailableError(sandboxId);
      }
      throw ex;
    }
  }

  async createSandbox(): Promise<{ sandboxId: string }> {
    return context.with(suppressTracing(context.active()), async () => {
      const { sandbox } = await this.getOrCreateSandbox();
      this.logger.debug(`Sandbox created: name=${sandbox.name}`);
      return { sandboxId: sandbox.name };
    });
  }

  /** Resolves undefined when no snapshot carries that name; auth/other failures throw. */
  private async getSnapshot(name: string): Promise<DaytonaSnapshot | undefined> {
    try {
      return await this.daytona.snapshot.get(name);
    } catch (error) {
      if (error instanceof DaytonaError && error.statusCode === SANDBOX_NOT_FOUND_STATUS) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * The SDK's `snapshot.create` polls until the snapshot is terminal, which can take
   * minutes on a cold image pull. Daytona registers the snapshot on the first request,
   * so fire the call in the background and observe progress via `getImageBuildStatus`.
   * A concurrent-create conflict is harmless: the winner's snapshot is the one polled.
   */
  private startImageBuild(): void {
    void this.daytona.snapshot
      .create({ name: this.buildRef, image: this.sandboxImage })
      .catch((error: unknown) => {
        this.logger.error(`Daytona snapshot create failed: name=${this.buildRef}`, extractErrorLogFields(error));
      });
  }

  /**
   * Drops a build stuck in a terminal-failure state so a fresh create can reuse its
   * deterministic name. A concurrent replica may have deleted it already (404) — that
   * is fine and treated as success.
   */
  private async deleteFailedBuild(snapshot: DaytonaSnapshot): Promise<void> {
    try {
      await this.daytona.snapshot.delete(snapshot);
    } catch (error) {
      if (error instanceof DaytonaError && error.statusCode === SANDBOX_NOT_FOUND_STATUS) {
        return;
      }
      throw error;
    }
  }

  /** Network-free build identity (ref + tag), so callers can describe the build even when Daytona is unreachable. */
  get buildMetadata(): SandboxBuildMetadata {
    return { buildRef: this.buildRef, imageTag: this.imageTag };
  }

  private build(status: SandboxBuild['status'], reason: string | null): SandboxBuild {
    return { status, reason, metadata: this.buildMetadata };
  }

  private toBuild(state: DaytonaSnapshot['state'], errorReason: string | null): SandboxBuild {
    switch (state) {
      case BUILD_STATE_ACTIVE:
        return this.build('ready', null);
      case BUILD_STATE_ERROR:
      case BUILD_STATE_BUILD_FAILED:
        return this.build('failed', errorReason ?? `Sandbox image build failed (${state}).`);
      default:
        // pending / building / pulling / removing / future states: not ready yet.
        return this.build('pending', `Sandbox image build in progress (${state}).`);
    }
  }

  async buildImage(): Promise<SandboxBuild> {
    const inFlight = DaytonaSandboxProvider.inFlightBuilds.get(this.buildRef);
    if (inFlight) return inFlight;

    const op = this.runBuild().finally(() => {
      DaytonaSandboxProvider.inFlightBuilds.delete(this.buildRef);
    });
    DaytonaSandboxProvider.inFlightBuilds.set(this.buildRef, op);
    return op;
  }

  private async runBuild(): Promise<SandboxBuild> {
    const existing = await this.getSnapshot(this.buildRef);
    if (existing) {
      // Daytona parks unused snapshots as 'inactive' after ~2 idle weeks; reactivate rather than rebuild.
      if (existing.state === BUILD_STATE_INACTIVE) {
        const activated = await this.daytona.snapshot.activate(existing);
        return this.toBuild(activated.state, activated.errorReason);
      }
      if (!isFailedBuildState(existing.state)) {
        return this.toBuild(existing.state, existing.errorReason);
      }
      // A failed build keeps the deterministic name occupied and never self-heals, so
      // re-saving settings (which calls buildImage) could never retry. Drop it, then recreate.
      await this.deleteFailedBuild(existing);
    }
    this.startImageBuild();
    return this.build('pending', 'Sandbox image build started.');
  }

  async getImageBuildStatus(): Promise<SandboxBuild> {
    const snapshot = await this.getSnapshot(this.buildRef);
    // Read-only: a missing build reports pending; PUT /settings/sandbox-providers starts the build.
    if (!snapshot) {
      return this.build('pending', 'Sandbox image build not started.');
    }
    return this.toBuild(snapshot.state, snapshot.errorReason);
  }

  async exec(params: SandboxExecParams): Promise<ExecResult> {
    return context.with(suppressTracing(context.active()), async (): Promise<ExecResult> => {
      try {
        return await this.executeWithSandboxRecovery(params.sandboxId, async () => {
          const { sandbox, defaultTimeoutMs } = await this.getOrCreateSandbox(params.sandboxId);
          const response = await sandbox.process.executeCommand(
            params.command,
            params.cwd,
            params.env ?? {},
            params.timeoutSeconds ?? defaultTimeoutMs / 1000,
          );
          return {
            success: true,
            response: { exitCode: response.exitCode, result: response.result },
          };
        });
      } catch (e: unknown) {
        DaytonaSandboxProvider.cachedSandboxes.delete(params.sandboxId);
        this.logger.error('Sandbox execution error', extractErrorLogFields(e));
        const message = e instanceof Error ? e.message : 'Unknown error';
        return { success: false, error: message };
      }
    });
  }

  private async getFileInfo(sandbox: Sandbox, path: string): Promise<SandboxFileInfo> {
    const details = await sandbox.fs.getFileDetails(path);
    return { size: details.size, isDir: details.isDir };
  }

  async downloadFile(params: { sandboxId: string; path: string }): Promise<Buffer> {
    return context.with(suppressTracing(context.active()), async () => {
      try {
        return await this.executeWithSandboxRecovery(params.sandboxId, async () => {
          const { sandbox } = await this.getOrCreateSandbox(params.sandboxId);

          const info = await this.getFileInfo(sandbox, params.path);
          if (info.isDir) {
            throw new SandboxPathIsDirectoryError(params.path);
          }
          if (info.size > this.fileMaxBytesForDownload) {
            throw new SandboxFileTooLargeError(params.path, info.size, this.fileMaxBytesForDownload);
          }

          return await sandbox.fs.downloadFile(params.path);
        });
      } catch (e: unknown) {
        if (e instanceof SandboxPathIsDirectoryError || e instanceof SandboxFileTooLargeError) throw e;
        if (e instanceof DaytonaError && e.statusCode === SANDBOX_NOT_FOUND_STATUS) {
          throw new SandboxFileNotFoundError(params.path);
        }
        DaytonaSandboxProvider.cachedSandboxes.delete(params.sandboxId);
        throw e;
      }
    });
  }

  async uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void> {
    return context.with(suppressTracing(context.active()), async () => {
      try {
        await this.executeWithSandboxRecovery(params.sandboxId, async () => {
          const { sandbox } = await this.getOrCreateSandbox(params.sandboxId);
          await sandbox.fs.uploadFile(params.content, params.remotePath);
        });
      } catch (e: unknown) {
        DaytonaSandboxProvider.cachedSandboxes.delete(params.sandboxId);
        throw e;
      }
    });
  }

  // Mints a signed, time-limited https preview URL exposing the given sandbox port.
  private async getPreviewUrl(params: { sandboxId: string; port: number; expiresInSeconds: number }): Promise<string> {
    return context.with(suppressTracing(context.active()), async () => {
      try {
        return await this.executeWithSandboxRecovery(params.sandboxId, async () => {
          const { sandbox } = await this.getOrCreateSandbox(params.sandboxId);
          const signed = await sandbox.getSignedPreviewUrl(params.port, params.expiresInSeconds);
          return signed.url;
        });
      } catch (e: unknown) {
        DaytonaSandboxProvider.cachedSandboxes.delete(params.sandboxId);
        this.logger.error('Failed to create signed preview URL', extractErrorLogFields(e));
        throw e;
      }
    });
  }

  async getNatsBridgeUrl(sandboxId: string): Promise<string> {
    // Daytona hands us a signed https preview URL; convert http(s) -> ws(s) for the NATS client.
    const previewUrl = await this.getPreviewUrl({
      sandboxId,
      port: this.natsBridgePort,
      expiresInSeconds: this.previewUrlExpirySeconds,
    });
    return httpUrlToWsUrl(previewUrl);
  }

  getAdditionalInstructions(): string | undefined {
    return undefined;
  }

  getToolResultDumpDir(): string {
    return '/tmp/tool-results';
  }

  getGitCredentialsPath(): string {
    // Isolated container per sandbox; absolute path so GIT_CONFIG_* needs no $HOME expansion.
    return '/tmp/.git-credentials';
  }
}
