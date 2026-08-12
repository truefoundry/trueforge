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
import { SANDBOX_IMAGE_NAME } from '../sandboxImage.gen';
import type {
  ExecResult,
  SandboxExecParams,
  SandboxFileInfo,
  SandboxImageBuild,
  SandboxProvider,
} from './Provider';

const SANDBOX_NOT_FOUND_STATUS = 404;
const SANDBOX_STATE_STARTED = 'started';

const SNAPSHOT_STATE_ACTIVE = 'active';
const SNAPSHOT_STATE_INACTIVE = 'inactive';
const SNAPSHOT_STATE_ERROR = 'error';
const SNAPSHOT_STATE_BUILD_FAILED = 'build_failed';

const SNAPSHOT_NAME_PREFIX = 'trueforge-snapshot-';

// The SDK does not export its branded `Snapshot` type; derive it from the client surface.
type DaytonaSnapshot = Awaited<ReturnType<Daytona['snapshot']['get']>>;

/** Tag portion of a container image reference (everything after the final `:`). */
function imageTag(image: string): string {
  return image.slice(image.lastIndexOf(':') + 1);
}

/** Deterministic snapshot name per image tag so every server replica converges on one snapshot. */
function deriveSnapshotName(tag: string): string {
  return `${SNAPSHOT_NAME_PREFIX}${tag}`;
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
  /** Tag of the release-owned sandbox image (from SANDBOX_IMAGE_NAME). */
  private readonly imageTag: string;
  /** Daytona snapshot name derived from the image tag; sandboxes are cloned from it. */
  private readonly snapshotRef: string;
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

  constructor(options: DaytonaSandboxProviderOptions) {
    this.daytona = options.client;
    this.tenantName = options.tenantName;
    this.imageTag = imageTag(SANDBOX_IMAGE_NAME);
    this.snapshotRef = deriveSnapshotName(this.imageTag);
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
          snapshot: this.snapshotRef,
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
  private startSnapshotCreate(): void {
    void this.daytona.snapshot
      .create({ name: this.snapshotRef, image: SANDBOX_IMAGE_NAME })
      .catch((error: unknown) => {
        this.logger.error(`Daytona snapshot create failed: name=${this.snapshotRef}`, extractErrorLogFields(error));
      });
  }

  private toImageBuild(snapshot: DaytonaSnapshot): SandboxImageBuild {
    const state = snapshot.state;
    switch (state) {
      case SNAPSHOT_STATE_ACTIVE:
        return { tag: this.imageTag, status: 'ready', ref: this.snapshotRef, errorMessage: null };
      case SNAPSHOT_STATE_ERROR:
      case SNAPSHOT_STATE_BUILD_FAILED:
        return {
          tag: this.imageTag,
          status: 'failed',
          ref: this.snapshotRef,
          errorMessage: snapshot.errorReason ?? `Daytona snapshot state: ${state}`,
        };
      // TODO: reactivate 'inactive' snapshots (Daytona parks unused snapshots after ~2 idle weeks) — deferred.
      case SNAPSHOT_STATE_INACTIVE:
      default:
        // inactive / pending / building / pulling / removing / future states: not ready yet.
        return { tag: this.imageTag, status: 'pending', ref: this.snapshotRef, errorMessage: null };
    }
  }

  async buildImage(): Promise<SandboxImageBuild> {
    const existing = await this.getSnapshot(this.snapshotRef);
    if (existing) {
      return this.toImageBuild(existing);
    }
    this.startSnapshotCreate();
    return { tag: this.imageTag, status: 'pending', ref: this.snapshotRef, errorMessage: null };
  }

  async getImageBuildStatus(): Promise<SandboxImageBuild> {
    const snapshot = await this.getSnapshot(this.snapshotRef);
    // Read-only: a missing snapshot reports pending; PUT /settings/sandbox-providers starts the build.
    if (!snapshot) {
      return { tag: this.imageTag, status: 'pending', ref: this.snapshotRef, errorMessage: null };
    }
    return this.toImageBuild(snapshot);
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
