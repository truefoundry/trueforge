import {
  ModalClient,
  NotFoundError,
  SandboxFilesystemFileTooLargeError,
  SandboxFilesystemIsADirectoryError,
  SandboxFilesystemNotFoundError,
  type App,
  type Image,
  type Sandbox as ModalSandbox,
} from 'modal';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join } from 'node:path/posix';
import type { Logger } from 'winston';
import { extractErrorLogFields } from '../../util/errorLogFields';
import {
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxNotAvailableError,
  SandboxPathIsDirectoryError,
  validateSandboxOwnedByTenant,
} from '../SandboxErrors';
import type { CodeModeTransport } from '../codeMode/CodeModeTransport';
import { CodeModeNatsTransport } from '../codeMode/nats/CodeModeNatsTransport';
import { DEFAULT_SANDBOX_NATS_WS_PORT } from '../constants';
import type { ExecResult, SandboxBuild, SandboxExecParams, SandboxProvider } from './Provider';

const SANDBOX_ROOT = '/opt/tf';
const DEFAULT_APP_NAME = 'trueforge';

function httpUrlToWsUrl(url: string): string {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  return parsed.toString();
}

function sandboxPath(path: string): string {
  return isAbsolute(path) ? path : join(SANDBOX_ROOT, path);
}

export interface ModalSandboxProviderOptions {
  tokenId: string;
  tokenSecret: string;
  tenantName: string;
  sandboxImage: string;
  buildRef?: string | undefined;
  environment?: string | undefined;
  appName?: string | undefined;
  timeoutMs: number;
  sandboxTimeoutMs: number;
  idleTimeoutMs: number;
  fileMaxBytesForDownload: number;
  natsBridgePort?: number | undefined;
  logger: Logger;
  /** Injectable for tests; production callers use the official Modal client. */
  client?: ModalClient | undefined;
}

/** Modal-backed implementation of the TrueForge sandbox contract. */
export class ModalSandboxProvider implements SandboxProvider {
  readonly type = 'modal';
  private readonly modal: ModalClient;
  private readonly tenantName: string;
  private readonly imageUri: string;
  private readonly buildRef: string | undefined;
  private readonly environment: string | undefined;
  private readonly appName: string;
  private readonly timeoutMs: number;
  private readonly sandboxTimeoutMs: number;
  private readonly idleTimeoutMs: number;
  private readonly fileMaxBytesForDownload: number;
  private readonly natsBridgePort: number;
  private readonly logger: Logger;

  constructor(options: ModalSandboxProviderOptions) {
    this.modal =
      options.client ??
      new ModalClient({
        tokenId: options.tokenId,
        tokenSecret: options.tokenSecret,
        ...(options.environment ? { environment: options.environment } : {}),
      });
    this.tenantName = options.tenantName;
    this.imageUri = options.sandboxImage;
    this.buildRef = options.buildRef;
    this.environment = options.environment;
    this.appName = options.appName ?? DEFAULT_APP_NAME;
    this.timeoutMs = options.timeoutMs;
    this.sandboxTimeoutMs = options.sandboxTimeoutMs;
    this.idleTimeoutMs = options.idleTimeoutMs;
    this.fileMaxBytesForDownload = options.fileMaxBytesForDownload;
    this.natsBridgePort = options.natsBridgePort ?? DEFAULT_SANDBOX_NATS_WS_PORT;
    this.logger = options.logger.child({ module: 'ModalProvider' });
  }

  private async app(): Promise<App> {
    return this.modal.apps.fromName(this.appName, {
      createIfMissing: true,
      ...(this.environment ? { environment: this.environment } : {}),
    });
  }

  private async image(): Promise<Image> {
    return this.buildRef ? this.modal.images.fromId(this.buildRef) : this.modal.images.fromRegistry(this.imageUri);
  }

  private async sandbox(sandboxId: string): Promise<ModalSandbox> {
    validateSandboxOwnedByTenant({ sandboxId, tenantName: this.tenantName });
    try {
      return await this.modal.sandboxes.fromName(this.appName, sandboxId, {
        ...(this.environment ? { environment: this.environment } : {}),
      });
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw new SandboxNotAvailableError(sandboxId);
      }
      throw error;
    }
  }

  async buildImage(): Promise<SandboxBuild> {
    if (this.buildRef) {
      return this.getImageBuildStatus();
    }
    try {
      const image = await this.modal.images.fromRegistry(this.imageUri).build(await this.app());
      return { status: 'ready', reason: null, metadata: { build_ref: image.imageId, image_uri: this.imageUri } };
    } catch (error) {
      this.logger.error('Modal image build failed', extractErrorLogFields(error));
      throw error;
    }
  }

  async getImageBuildStatus(): Promise<SandboxBuild> {
    if (!this.buildRef) {
      return { status: 'pending', reason: 'Sandbox image build not started.', metadata: { image_uri: this.imageUri } };
    }
    try {
      await this.modal.images.fromId(this.buildRef);
      return { status: 'ready', reason: null, metadata: { build_ref: this.buildRef, image_uri: this.imageUri } };
    } catch (error) {
      if (error instanceof NotFoundError) {
        return {
          status: 'failed',
          reason: 'The built Modal image no longer exists.',
          metadata: { build_ref: this.buildRef, image_uri: this.imageUri },
        };
      }
      throw error;
    }
  }

  async createSandbox(): Promise<{ sandboxId: string }> {
    const sandboxId = `${this.tenantName}.${randomUUID()}`;
    const sandbox = await this.modal.sandboxes.create(await this.app(), await this.image(), {
      name: sandboxId,
      timeoutMs: this.sandboxTimeoutMs,
      idleTimeoutMs: this.idleTimeoutMs,
      workdir: SANDBOX_ROOT,
      encryptedPorts: [this.natsBridgePort],
    });
    this.logger.debug(`Modal sandbox created: id=${sandbox.sandboxId} name=${sandboxId}`);
    return { sandboxId };
  }

  async exec(params: SandboxExecParams): Promise<ExecResult> {
    try {
      const sandbox = await this.sandbox(params.sandboxId);
      const process = await sandbox.exec(['/bin/sh', '-lc', params.command], {
        workdir: params.cwd ?? SANDBOX_ROOT,
        timeoutMs: (params.timeoutSeconds ?? this.timeoutMs / 1000) * 1000,
        ...(params.env ? { env: params.env } : {}),
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        process.stdout.readText(),
        process.stderr.readText(),
        process.wait(),
      ]);
      return { success: true, response: { exitCode, result: `${stdout}${stderr}` } };
    } catch (error) {
      if (error instanceof SandboxNotAvailableError) {
        throw error;
      }
      this.logger.error('Modal sandbox execution error', extractErrorLogFields(error));
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async downloadFile(params: { sandboxId: string; path: string }): Promise<Buffer> {
    try {
      const filesystem = (await this.sandbox(params.sandboxId)).filesystem;
      const remotePath = sandboxPath(params.path);
      const parentPath = remotePath.slice(0, remotePath.lastIndexOf('/')) || '/';
      const fileInfo = (await filesystem.listFiles(parentPath)).find(entry => entry.path === remotePath);
      if (fileInfo === undefined) {
        throw new SandboxFileNotFoundError(params.path);
      }
      if (fileInfo.type === 'directory') {
        throw new SandboxPathIsDirectoryError(params.path);
      }
      if (fileInfo.size > this.fileMaxBytesForDownload) {
        throw new SandboxFileTooLargeError(params.path, fileInfo.size, this.fileMaxBytesForDownload);
      }
      return Buffer.from(await filesystem.readBytes(remotePath));
    } catch (error) {
      if (error instanceof SandboxFilesystemNotFoundError) {
        throw new SandboxFileNotFoundError(params.path);
      }
      if (error instanceof SandboxFilesystemIsADirectoryError) {
        throw new SandboxPathIsDirectoryError(params.path);
      }
      if (error instanceof SandboxFilesystemFileTooLargeError) {
        throw new SandboxFileTooLargeError(params.path, this.fileMaxBytesForDownload + 1, this.fileMaxBytesForDownload);
      }
      throw error;
    }
  }

  async uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void> {
    await (await this.sandbox(params.sandboxId)).filesystem.writeBytes(params.content, sandboxPath(params.remotePath));
  }

  createCodeModeTransport(): CodeModeTransport {
    return new CodeModeNatsTransport({
      resolveHostUrl: async sandboxId => {
        const tunnels = await (await this.sandbox(sandboxId)).tunnels();
        const tunnel = tunnels[this.natsBridgePort];
        if (!tunnel) {
          throw new Error(`Modal did not expose sandbox port ${String(this.natsBridgePort)}.`);
        }
        return httpUrlToWsUrl(tunnel.url);
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
  getToolResultDumpDir(): string {
    return join(SANDBOX_ROOT, 'tool-results');
  }
  getGitCredentialsPath(): string {
    return join(SANDBOX_ROOT, '.git-credentials');
  }
  getFileUploadsDir(): string {
    return join(SANDBOX_ROOT, 'uploads');
  }
  getSkillsDir(): string {
    return join(SANDBOX_ROOT, 'skills');
  }
  getGitDownloaderPath(): string {
    return join(SANDBOX_ROOT, 'git_downloader.py');
  }
}
