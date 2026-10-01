import type { CreateSandboxFromSnapshotParams, Sandbox, Snapshot } from '@daytona/sdk';
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
import { DAYTONA_SNAPSHOT_NOT_STARTED_REASON, type DaytonaSandboxEnvironment } from './DaytonaSandboxEnvironment';
import type {
  ExecResult,
  SandboxBuild,
  SandboxCreateSecretParams,
  SandboxDeleteSecretParams,
  SandboxExecParams,
  SandboxFileInfo,
  SandboxProvider,
  SandboxUpdateSecretParams,
} from './Provider';

const SANDBOX_NOT_FOUND_STATUS = 404;
const SANDBOX_STATE_STARTED = 'started';
/** Another replica already registered this build name; its create is the one that counts. */
const SNAPSHOT_CONFLICT_STATUS = 409;

const BUILD_STATE_ACTIVE = 'active';
const BUILD_STATE_ERROR = 'error';
const BUILD_STATE_BUILD_FAILED = 'build_failed';

/** Same default the Daytona SDK applies when `DaytonaConfig.apiUrl` is omitted. */
const DEFAULT_DAYTONA_API_URL = 'https://app.daytona.io/api';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

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

export class DaytonaSandboxProvider implements SandboxProvider<DaytonaSandboxEnvironment> {
  readonly type = 'daytona';
  readonly envSupported = true;
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
  private requireEnvironment(environment?: DaytonaSandboxEnvironment): DaytonaSandboxEnvironment {
    if (environment === undefined) {
      throw new Error('Daytona sandbox create requires a DaytonaSandboxEnvironment');
    }
    return environment;
  }

  /** Lightweight authz probe (list one snapshot page) — no snapshot build. */
  async validateAccess(): Promise<void> {
    await withTimeout(this.daytona.snapshot.list({ page: 1, limit: 1 }), 3_000, 'sandbox credentials check');
  }

  private runtimeCreateParams(environment: DaytonaSandboxEnvironment): {
    envVars?: Record<string, string>;
    networkBlockAll?: boolean;
    domainAllowList?: string;
    secrets?: Record<string, string>;
  } {
    const networking = environment.networking;
    return {
      ...(environment.environment_variables ? { envVars: environment.environment_variables } : {}),
      ...(networking?.network_block_all ? { networkBlockAll: networking.network_block_all } : {}),
      ...(networking?.domain_allow_list ? { domainAllowList: networking.domain_allow_list } : {}),
      ...(environment.mounted_secrets ? { secrets: environment.mounted_secrets } : {}),
    };
  }

  /** Create a Daytona secret (value write-only). */
  async createSecret(params: SandboxCreateSecretParams): Promise<{ id: string; name: string }> {
    const secret = await this.daytona.secret.create({
      name: params.name,
      value: params.value,
      description: params.description,
      hosts: params.hosts,
    });
    return { id: secret.id, name: secret.name };
  }

  /** Update a Daytona secret (hosts and optional value). */
  async updateSecret(params: SandboxUpdateSecretParams): Promise<void> {
    await this.daytona.secret.update(params.secretId, {
      hosts: params.hosts,
      ...(params.value ? { value: params.value } : {}),
    });
  }

  /** Delete a Daytona secret by id. */
  async deleteSecret(params: SandboxDeleteSecretParams): Promise<void> {
    await this.daytona.secret.delete(params.secretId);
  }

  private toBuild({
    environment,
    state,
    errorReason,
  }: {
    environment: DaytonaSandboxEnvironment;
    state: string;
    errorReason: string | null;
  }): SandboxBuild {
    const metadata = { build_ref: environment.snapshot_ref, image_uri: environment.image_uri };
    switch (state) {
      case BUILD_STATE_ACTIVE:
        return { status: 'ready', reason: null, metadata };
      case BUILD_STATE_ERROR:
      case BUILD_STATE_BUILD_FAILED:
        return { status: 'failed', reason: errorReason ?? `Sandbox image build failed (${state}).`, metadata };
      default:
        return { status: 'pending', reason: `Sandbox image build in progress (${state}).`, metadata };
    }
  }

  /** Resolves undefined when no snapshot carries that name; auth/other failures throw. */
  private async getSnapshot(snapshotRef: string): Promise<Snapshot | undefined> {
    try {
      return await this.daytona.snapshot.get(snapshotRef);
    } catch (error) {
      if (error instanceof DaytonaError && error.statusCode === SANDBOX_NOT_FOUND_STATUS) {
        return undefined;
      }
      throw error;
    }
  }

  /**
   * Dockerfile that layers `build_script` onto the release base image.
   * JSON-array RUN keeps the script bytes intact (newlines, quotes) without shell-escaping hell.
   */
  private dockerfileFromBuildScript({ imageUri, buildScript }: { imageUri: string; buildScript: string }): string {
    return `FROM ${imageUri}\nRUN ["bash", "-lc", ${JSON.stringify(buildScript)}]`;
  }

  /** Body for POST /snapshots — imageName XOR buildInfo (Daytona mutual exclusion). */
  private createSnapshotBody(environment: DaytonaSandboxEnvironment): {
    name: string;
    cpu: number;
    memory: number;
    disk: number;
    imageName?: string;
    buildInfo?: { dockerfileContent: string };
  } {
    const body: {
      name: string;
      cpu: number;
      memory: number;
      disk: number;
      imageName?: string;
      buildInfo?: { dockerfileContent: string };
    } = {
      name: environment.snapshot_ref,
      cpu: environment.resources.cpu,
      memory: environment.resources.memory,
      disk: environment.resources.disk,
    };
    const buildScript = environment.image?.type === 'build' ? environment.image.build_script : undefined;
    if (buildScript !== undefined && buildScript.length > 0) {
      body.buildInfo = {
        dockerfileContent: this.dockerfileFromBuildScript({
          imageUri: environment.image_uri,
          buildScript,
        }),
      };
    } else {
      body.imageName = environment.image_uri;
    }
    return body;
  }

  /**
   * Registers the snapshot and returns its initial state without waiting for the build.
   *
   * The SDK's `snapshot.create` issues this same POST and then polls until the snapshot is active
   * or failed (minutes on a cold image pull). Progress only needs the registration result, so
   * credential errors surface on the request while build progress stays observable via get.
   */
  private async registerSnapshot(
    environment: DaytonaSandboxEnvironment,
  ): Promise<{ state: string; errorReason: string | null }> {
    let response: Response;
    try {
      response = await fetch(`${this.apiUrl}/snapshots`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.createSnapshotBody(environment)),
      });
    } catch (error) {
      throw new Error('Daytona snapshot registration request failed.', { cause: error });
    }

    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        isRecord(body) && typeof body['message'] === 'string'
          ? body['message']
          : `Daytona snapshot registration failed (${String(response.status)})`;
      throw new DaytonaError(message, response.status);
    }
    if (!isRecord(body) || typeof body['state'] !== 'string') {
      throw new DaytonaError("Failed to register snapshot. Daytona didn't return a snapshot state.");
    }
    return {
      state: body['state'],
      errorReason: typeof body['errorReason'] === 'string' ? body['errorReason'] : null,
    };
  }

  /**
   * Registers this environment's snapshot. Does not wait for the build to finish.
   * Callers that are polling should use getBuildStatus; only call build when not started.
   */
  async build(environment: DaytonaSandboxEnvironment): Promise<SandboxBuild> {
    try {
      const registered = await this.registerSnapshot(environment);
      return this.toBuild({
        environment,
        state: registered.state,
        errorReason: registered.errorReason,
      });
    } catch (error) {
      // A losing concurrent create is not a build failure: read whatever the winner registered.
      if (error instanceof DaytonaError && error.statusCode === SNAPSHOT_CONFLICT_STATUS) {
        this.logger.info(`Daytona snapshot already created concurrently: name=${environment.snapshot_ref}`);
        return this.getBuildStatus(environment);
      }
      throw error;
    }
  }

  /** Current build status for this environment. Read-only: never kicks off a build. */
  async getBuildStatus(environment: DaytonaSandboxEnvironment): Promise<SandboxBuild> {
    const snapshot = await this.getSnapshot(environment.snapshot_ref);
    if (!snapshot) {
      return {
        status: 'pending',
        reason: DAYTONA_SNAPSHOT_NOT_STARTED_REASON,
        metadata: { build_ref: environment.snapshot_ref, image_uri: environment.image_uri },
      };
    }
    return this.toBuild({
      environment,
      state: snapshot.state,
      errorReason: snapshot.errorReason,
    });
  }

  private async getOrCreateSandbox(
    sandboxId?: string,
    environment?: DaytonaSandboxEnvironment,
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

  private buildCreateParams(environment?: DaytonaSandboxEnvironment): CreateSandboxFromSnapshotParams {
    const env = this.requireEnvironment(environment);
    return {
      name: `${this.tenantName}.${randomUUID()}`,
      snapshot: env.snapshot_ref,
      autoStopInterval: this.autoStopIntervalInMinutes,
      autoArchiveInterval: this.autoArchiveIntervalInMinutes,
      autoDeleteInterval: this.autoDeleteIntervalInMinutes,
      ...this.runtimeCreateParams(env),
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

  async createSandbox(environment?: DaytonaSandboxEnvironment): Promise<{ sandboxId: string }> {
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
