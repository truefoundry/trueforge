import { context } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import {
  AuthenticationError,
  CommandExitError,
  E2B,
  FileNotFoundError,
  FileType,
  SandboxNotFoundError,
  waitForPort,
  type Sandbox as E2BSandbox,
  type TemplateBuildStatus,
} from 'e2b';
import { join } from 'node:path/posix';
import type { Logger } from 'winston';
import { extractErrorLogFields } from '../../util/errorLogFields';
import type { CodeModeTransport } from '../codeMode/CodeModeTransport';
import { CodeModeNatsTransport, type CodeModeHostConnection } from '../codeMode/nats/CodeModeNatsTransport';
import { DEFAULT_SANDBOX_NATS_WS_PORT } from '../constants';
import {
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxNotAvailableError,
  SandboxPathIsDirectoryError,
  validateSandboxTenantMetadata,
} from '../SandboxErrors';
import { deriveSandboxImageBuildName } from './imageReference';
import type { ExecResult, SandboxBuild, SandboxExecParams, SandboxProvider } from './Provider';

const E2B_WORKDIR = '/home/trueforge';
const TENANT_METADATA_KEY = 'trueforge_tenant_id';
const TRAFFIC_ACCESS_TOKEN_HEADER = 'E2B-Traffic-Access-Token';

function buildReason(status: TemplateBuildStatus, reason: string | undefined): string | null {
  switch (status) {
    case 'ready':
      return null;
    case 'error':
      return reason ?? 'Sandbox image build failed.';
    case 'building':
    case 'waiting':
      return `Sandbox image build in progress (${status}).`;
  }
}

function commandOutput(params: { chunks: string[]; stdout: string; stderr: string }): string {
  return params.chunks.length > 0 ? params.chunks.join('') : `${params.stdout}${params.stderr}`;
}

/** Resolves the secure E2B host and its sandbox-bound upgrade credential as one value. */
export function resolveE2BCodeModeHost(params: { sandbox: E2BSandbox; port: number }): CodeModeHostConnection {
  const trafficAccessToken = params.sandbox.trafficAccessToken;
  if (trafficAccessToken === undefined) {
    throw new Error('E2B did not return a traffic access token for secure sandbox ingress.');
  }
  return {
    url: `wss://${params.sandbox.getHost(params.port)}`,
    webSocketHeaders: { [TRAFFIC_ACCESS_TOKEN_HEADER]: trafficAccessToken },
  };
}

export interface E2BSandboxProviderOptions {
  /** Caller-owned E2B client with credentials isolated from other tenants. */
  client: E2B;
  tenantName: string;
  /** Release-owned image converted to an E2B template. */
  sandboxImage: string;
  buildRef?: string | undefined;
  buildId?: string | undefined;
  templateId?: string | undefined;
  execTimeoutMs: number;
  sandboxTimeoutMs: number;
  fileMaxBytesForDownload: number;
  natsBridgePort?: number | undefined;
  logger: Logger;
}

export class E2BSandboxProvider implements SandboxProvider {
  readonly type = 'e2b';

  private readonly client: E2B;
  private readonly tenantName: string;
  private readonly imageUri: string;
  private readonly buildRef: string;
  private readonly buildId: string | undefined;
  private readonly templateId: string | undefined;
  private readonly execTimeoutMs: number;
  private readonly sandboxTimeoutMs: number;
  private readonly fileMaxBytesForDownload: number;
  private readonly natsBridgePort: number;
  private readonly logger: Logger;
  private readonly cachedSandboxes = new Map<string, E2BSandbox>();

  constructor(options: E2BSandboxProviderOptions) {
    this.client = options.client;
    this.tenantName = options.tenantName;
    this.imageUri = options.sandboxImage;
    this.buildRef = options.buildRef ?? deriveSandboxImageBuildName(options.sandboxImage);
    this.buildId = options.buildId;
    this.templateId = options.templateId;
    this.execTimeoutMs = options.execTimeoutMs;
    this.sandboxTimeoutMs = options.sandboxTimeoutMs;
    this.fileMaxBytesForDownload = options.fileMaxBytesForDownload;
    this.natsBridgePort = options.natsBridgePort ?? DEFAULT_SANDBOX_NATS_WS_PORT;
    this.logger = options.logger.child({ module: 'E2BProvider' });
  }

  private buildMetadata(params: {
    buildId: string | undefined;
    templateId: string | undefined;
  }): Record<string, string> {
    return {
      build_ref: this.buildRef,
      image_uri: this.imageUri,
      ...(params.buildId === undefined ? {} : { build_id: params.buildId }),
      ...(params.templateId === undefined ? {} : { template_id: params.templateId }),
    };
  }

  private toBuild(params: {
    status: TemplateBuildStatus;
    reason: string | undefined;
    buildId: string | undefined;
    templateId: string | undefined;
  }): SandboxBuild {
    return {
      status: params.status === 'ready' ? 'ready' : params.status === 'error' ? 'failed' : 'pending',
      reason: buildReason(params.status, params.reason),
      metadata: this.buildMetadata({ buildId: params.buildId, templateId: params.templateId }),
    };
  }

  private async getPersistedBuildStatus(): Promise<SandboxBuild | undefined> {
    if (this.buildId === undefined || this.templateId === undefined) {
      return undefined;
    }
    const build = await this.client.Template.getBuildStatus({ buildId: this.buildId, templateId: this.templateId });
    return this.toBuild({
      status: build.status,
      reason: build.reason?.message,
      buildId: build.buildID,
      templateId: build.templateID,
    });
  }

  async buildImage(): Promise<SandboxBuild> {
    const persisted = await this.getPersistedBuildStatus();
    if (persisted !== undefined && persisted.status !== 'failed') {
      return persisted;
    }
    if (persisted === undefined && (await this.client.Template.exists(this.buildRef))) {
      return {
        status: 'ready',
        reason: null,
        metadata: this.buildMetadata({ buildId: undefined, templateId: undefined }),
      };
    }

    const template = this.client
      .Template()
      .fromImage(this.imageUri)
      .setUser('root')
      .setWorkdir(E2B_WORKDIR)
      .setStartCmd('/usr/bin/supervisord -n', waitForPort(this.natsBridgePort));
    const build = await this.client.Template.buildInBackground(template, this.buildRef);
    return {
      status: 'pending',
      reason: 'Sandbox image build started.',
      metadata: this.buildMetadata({ buildId: build.buildId, templateId: build.templateId }),
    };
  }

  async getImageBuildStatus(): Promise<SandboxBuild> {
    const persisted = await this.getPersistedBuildStatus();
    if (persisted !== undefined) {
      return persisted;
    }
    if (await this.client.Template.exists(this.buildRef)) {
      return {
        status: 'ready',
        reason: null,
        metadata: this.buildMetadata({ buildId: undefined, templateId: undefined }),
      };
    }
    return {
      status: 'pending',
      reason: 'Sandbox image build not started.',
      metadata: this.buildMetadata({ buildId: undefined, templateId: undefined }),
    };
  }

  private async restoreExistingSandbox(sandboxId: string): Promise<E2BSandbox> {
    try {
      const info = await this.client.Sandbox.getInfo(sandboxId);
      validateSandboxTenantMetadata({
        tenantName: this.tenantName,
        ownerTenantName: info.metadata[TENANT_METADATA_KEY],
      });
      return await this.client.Sandbox.connect(sandboxId, { timeoutMs: this.sandboxTimeoutMs });
    } catch (error) {
      if (error instanceof SandboxNotFoundError) {
        throw new SandboxNotAvailableError(sandboxId, { cause: error });
      }
      throw error;
    }
  }

  private async getOrCreateSandbox(sandboxId: string | undefined): Promise<E2BSandbox> {
    if (sandboxId !== undefined) {
      const cached = this.cachedSandboxes.get(sandboxId);
      if (cached !== undefined) {
        return cached;
      }
    }

    const sandbox =
      sandboxId === undefined
        ? await this.client.Sandbox.create(this.templateId ?? this.buildRef, {
            timeoutMs: this.sandboxTimeoutMs,
            metadata: { [TENANT_METADATA_KEY]: this.tenantName },
            secure: true,
            network: { allowPublicTraffic: false },
            lifecycle: { onTimeout: 'pause', autoResume: true },
          })
        : await this.restoreExistingSandbox(sandboxId);
    this.cachedSandboxes.set(sandbox.sandboxId, sandbox);
    return sandbox;
  }

  async createSandbox(): Promise<{ sandboxId: string }> {
    return context.with(suppressTracing(context.active()), async () => {
      const sandbox = await this.getOrCreateSandbox(undefined);
      this.logger.debug(`Sandbox created: id=${sandbox.sandboxId}`);
      return { sandboxId: sandbox.sandboxId };
    });
  }

  async exec(params: SandboxExecParams): Promise<ExecResult> {
    return context.with(suppressTracing(context.active()), async (): Promise<ExecResult> => {
      const output: string[] = [];
      try {
        const sandbox = await this.getOrCreateSandbox(params.sandboxId);
        const result = await sandbox.commands.run(params.command, {
          cwd: params.cwd ?? E2B_WORKDIR,
          envs: params.env ?? {},
          timeoutMs: params.timeoutSeconds === undefined ? this.execTimeoutMs : params.timeoutSeconds * 1000,
          onStdout: chunk => {
            output.push(chunk);
          },
          onStderr: chunk => {
            output.push(chunk);
          },
        });
        return {
          success: true,
          response: {
            exitCode: result.exitCode,
            result: commandOutput({ chunks: output, stdout: result.stdout, stderr: result.stderr }),
          },
        };
      } catch (error) {
        if (error instanceof CommandExitError) {
          return {
            success: true,
            response: {
              exitCode: error.exitCode,
              result: commandOutput({ chunks: output, stdout: error.stdout, stderr: error.stderr }),
            },
          };
        }
        this.cachedSandboxes.delete(params.sandboxId);
        if (error instanceof SandboxNotAvailableError) {
          throw error;
        }
        if (error instanceof SandboxNotFoundError) {
          throw new SandboxNotAvailableError(params.sandboxId, { cause: error });
        }
        this.logger.error('Sandbox execution error', extractErrorLogFields(error));
        return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
      }
    });
  }

  async downloadFile(params: { sandboxId: string; path: string }): Promise<Buffer> {
    return context.with(suppressTracing(context.active()), async () => {
      try {
        const sandbox = await this.getOrCreateSandbox(params.sandboxId);
        const info = await sandbox.files.getInfo(params.path);
        if (info.type === FileType.DIR) {
          throw new SandboxPathIsDirectoryError(params.path);
        }
        if (info.size > this.fileMaxBytesForDownload) {
          throw new SandboxFileTooLargeError(params.path, info.size, this.fileMaxBytesForDownload);
        }
        return Buffer.from(await sandbox.files.read(params.path, { format: 'bytes' }));
      } catch (error) {
        if (error instanceof FileNotFoundError) {
          throw new SandboxFileNotFoundError(params.path, { cause: error });
        }
        if (error instanceof SandboxNotFoundError) {
          this.cachedSandboxes.delete(params.sandboxId);
          throw new SandboxNotAvailableError(params.sandboxId, { cause: error });
        }
        throw error;
      }
    });
  }

  async uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void> {
    return context.with(suppressTracing(context.active()), async () => {
      try {
        const sandbox = await this.getOrCreateSandbox(params.sandboxId);
        const bytes = Uint8Array.from(params.content);
        await sandbox.files.write(params.remotePath, bytes.buffer);
      } catch (error) {
        if (error instanceof SandboxNotFoundError) {
          this.cachedSandboxes.delete(params.sandboxId);
          throw new SandboxNotAvailableError(params.sandboxId, { cause: error });
        }
        throw error;
      }
    });
  }

  createCodeModeTransport(): CodeModeTransport {
    return new CodeModeNatsTransport({
      resolveHostConnection: async sandboxId => {
        const sandbox = await this.getOrCreateSandbox(sandboxId);
        return resolveE2BCodeModeHost({ sandbox, port: this.natsBridgePort });
      },
      sandboxClientNatsUrl: `ws://localhost:${String(this.natsBridgePort)}`,
      logger: this.logger,
      mcpClientInstall: {
        remotePath: join(E2B_WORKDIR, 'mcp-client', 'mcp_client.py'),
        pathBinSymlink: join('/usr', 'local', 'bin', 'mcp-client'),
      },
    });
  }

  getAdditionalInstructions(): string | undefined {
    return undefined;
  }

  getToolResultDumpDir(): string {
    return join(E2B_WORKDIR, 'tool-results');
  }

  getGitCredentialsPath(): string {
    return join(E2B_WORKDIR, '.git-credentials');
  }

  getFileUploadsDir(): string {
    return join(E2B_WORKDIR, 'uploads');
  }

  getSkillsDir(): string {
    return join(E2B_WORKDIR, 'skills');
  }

  getGitDownloaderPath(): string {
    return join(E2B_WORKDIR, 'git_downloader.py');
  }
}

export function isE2BAuthError(error: unknown): boolean {
  return error instanceof AuthenticationError;
}
