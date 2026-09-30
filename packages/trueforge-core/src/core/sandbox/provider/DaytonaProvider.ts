import type { CreateSandboxFromSnapshotParams, Sandbox } from '@daytona/sdk';
import { Daytona, DaytonaError } from '@daytona/sdk';
import { context } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path/posix';
import type { Logger } from 'winston';
import { extractErrorLogFields } from '../../util/errorLogFields';
import { withTimeout } from '../../util/promiseUtils';
import {
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxNotAvailableError,
  SandboxPathIsDirectoryError,
  validateSandboxOwnedByTenant,
} from '../SandboxErrors';
import type { CodeModeTransport } from '../codeMode/CodeModeTransport';
import { CodeModeNatsTransport } from '../codeMode/nats/CodeModeNatsTransport';
import { DEFAULT_PREVIEW_URL_EXPIRY_SECONDS, DEFAULT_SANDBOX_NATS_WS_PORT } from '../constants';
import {
  DaytonaSandboxEnvironment,
  isDaytonaSandboxEnvironment,
  type DaytonaProviderContext,
} from './DaytonaSandboxEnvironment';
import type { ExecResult, SandboxEnvironment, SandboxExecParams, SandboxFileInfo, SandboxProvider } from './Provider';

const SANDBOX_NOT_FOUND_STATUS = 404;
const SANDBOX_STATE_STARTED = 'started';

/** Same default the Daytona SDK applies when `DaytonaConfig.apiUrl` is omitted. */
const DEFAULT_DAYTONA_API_URL = 'https://app.daytona.io/api';

/** Convert Daytona https preview URLs to wss for the NATS client. */
function httpUrlToWsUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol === 'https:') {
    parsed.protocol = 'wss:';
  } else if (parsed.protocol === 'http:') {
    parsed.protocol = 'ws:';
  }
  return parsed.toString();
}

export interface DaytonaSandboxProviderOptions {
  /** Caller-owned Daytona SDK client (credentials / lifetime). */
  client: Daytona;
  /**
   * Same API key the client was built with; used for the register-only snapshot POST because the
   * SDK's `snapshot.create` polls to a terminal state instead of returning once registered.
   */
  apiKey: string;
  /** Daytona API base URL (including `/api`). Defaults to the SDK's public cloud endpoint. */
  apiUrl?: string | undefined;
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
  readonly type = 'daytona';
  private readonly tenantName: string;
  private readonly timeoutMs: number;
  private readonly autoStopIntervalInMinutes: number;
  private readonly autoArchiveIntervalInMinutes: number;
  private readonly autoDeleteIntervalInMinutes: number;
  private readonly fileMaxBytesForDownload: number;
  private readonly natsBridgePort: number;
  private readonly previewUrlExpirySeconds: number;
  private readonly apiKey: string;
  private readonly apiUrl: string;
  private readonly logger: Logger;
  private readonly daytona: Daytona;
  private static readonly cachedSandboxes = new Map<string, { sandbox: Sandbox; defaultTimeoutMs: number }>();
  // De-dupes concurrent recovery attempts on the same sandbox to a single refreshData+start round-trip.
  private static readonly inFlightRecoveries = new Map<string, Promise<boolean>>();

  constructor(options: DaytonaSandboxProviderOptions) {
    this.daytona = options.client;
    this.apiKey = options.apiKey;
    this.apiUrl = options.apiUrl ?? DEFAULT_DAYTONA_API_URL;
    this.tenantName = options.tenantName;
    this.timeoutMs = options.timeoutMs;
    this.autoStopIntervalInMinutes = options.autoStopIntervalInMinutes;
    this.autoArchiveIntervalInMinutes = options.autoArchiveIntervalInMinutes;
    this.autoDeleteIntervalInMinutes = options.autoDeleteIntervalInMinutes;
    this.fileMaxBytesForDownload = options.fileMaxBytesForDownload;
    this.natsBridgePort = options.natsBridgePort ?? DEFAULT_SANDBOX_NATS_WS_PORT;
    this.previewUrlExpirySeconds = options.previewUrlExpirySeconds ?? DEFAULT_PREVIEW_URL_EXPIRY_SECONDS;
    this.logger = options.logger.child({ module: 'DaytonaProvider' });
  }

  /** Require a Daytona environment for fresh creates. */
  private requireEnvironment(environment?: SandboxEnvironment): DaytonaSandboxEnvironment {
    if (environment === undefined) {
      throw new Error('Daytona sandbox create requires a SandboxEnvironment');
    }
    if (!isDaytonaSandboxEnvironment(environment)) {
      throw new Error(`Daytona sandbox provider cannot use environment type "${environment.type}"`);
    }
    return environment;
  }

  /** Credentials + client for DaytonaSandboxEnvironment.build / getBuildStatus. */
  providerContext(): DaytonaProviderContext {
    return {
      client: this.daytona,
      apiKey: this.apiKey,
      apiUrl: this.apiUrl,
      logger: this.logger,
    };
  }

  /** Lightweight authz probe (list one snapshot page) — no snapshot build. */
  async validateAccess(): Promise<void> {
    await withTimeout(this.daytona.snapshot.list({ page: 1, limit: 1 }), 3_000, 'sandbox credentials check');
  }

  private async getOrCreateSandbox(
    sandboxId?: string,
    environment?: SandboxEnvironment,
  ): Promise<{ sandbox: Sandbox; defaultTimeoutMs: number }> {
    if (sandboxId) {
      validateSandboxOwnedByTenant({ sandboxId, tenantName: this.tenantName });
      const cached = DaytonaSandboxProvider.cachedSandboxes.get(sandboxId);
      if (cached) {
        return cached;
      }
    }

    const sandbox = sandboxId
      ? await this.restoreExistingSandbox(sandboxId)
      : await this.daytona.create(this.buildCreateParams(environment));

    const entry = { sandbox, defaultTimeoutMs: this.timeoutMs };
    DaytonaSandboxProvider.cachedSandboxes.set(sandbox.name, entry);
    return entry;
  }

  private buildCreateParams(environment?: SandboxEnvironment): CreateSandboxFromSnapshotParams {
    const env = this.requireEnvironment(environment);
    return {
      name: `${this.tenantName}.${randomUUID()}`,
      snapshot: env.snapshot_ref,
      autoStopInterval: this.autoStopIntervalInMinutes,
      autoArchiveInterval: this.autoArchiveIntervalInMinutes,
      autoDeleteInterval: this.autoDeleteIntervalInMinutes,
      ...env.runtimeCreateParams(),
    };
  }

  // Returns true iff the caller should retry: either we restarted a stopped sandbox, or the cache entry is missing and the retry will rebuild it via the cold path.
  private static recoverSandboxIfStopped(sandboxId: string): Promise<boolean> {
    const existing = DaytonaSandboxProvider.inFlightRecoveries.get(sandboxId);
    if (existing) {
      return existing;
    }

    const cached = DaytonaSandboxProvider.cachedSandboxes.get(sandboxId);
    // Cache may have been evicted by a concurrent error path; signal retry so getOrCreateSandbox rebuilds via restoreExistingSandbox.
    if (!cached) {
      return Promise.resolve(true);
    }

    const recovery = (async () => {
      await cached.sandbox.refreshData();
      if (cached.sandbox.state === SANDBOX_STATE_STARTED) {
        return false;
      }
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
      if (!(originalError instanceof DaytonaError)) {
        throw originalError;
      }

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

      if (!recovered) {
        throw originalError;
      }

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

  async createSandbox(environment?: SandboxEnvironment): Promise<{ sandboxId: string }> {
    return context.with(suppressTracing(context.active()), async () => {
      const { sandbox } = await this.getOrCreateSandbox(undefined, environment);
      this.logger.debug(`Sandbox created: name=${sandbox.name}`);
      return { sandboxId: sandbox.name };
    });
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
        if (e instanceof SandboxNotAvailableError) {
          throw e;
        }
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
        if (e instanceof SandboxPathIsDirectoryError || e instanceof SandboxFileTooLargeError) {
          throw e;
        }
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

  createCodeModeTransport(): CodeModeTransport {
    return new CodeModeNatsTransport({
      resolveHostUrl: async (sandboxId: string) => {
        const previewUrl = await this.getPreviewUrl({
          sandboxId,
          port: this.natsBridgePort,
          expiresInSeconds: this.previewUrlExpirySeconds,
        });
        return httpUrlToWsUrl(previewUrl);
      },
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

  // Isolated container: image-absolute layout. GIT_CONFIG store --file needs an absolute path.
  //   /opt/tf/{uploads,skills,tool-results,skill_downloader.py,.git-credentials}
  //   /opt/tfy/mcp-client/mcp_client.py  +  /usr/local/bin/mcp-client (image PATH; no layout bin)
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

  getSkillDownloaderPath(): string {
    return join('/opt', 'tf', 'skill_downloader.py');
  }
}
