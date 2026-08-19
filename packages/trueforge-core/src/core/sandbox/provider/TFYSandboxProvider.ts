import { context } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import { randomUUID } from 'crypto';
import dedent from 'dedent';
import type { Logger } from 'winston';
import { extractErrorLogFields } from '../../util/errorLogFields';
import type { CodeModeTransport } from '../codeMode/CodeModeTransport';
import { CodeModeNatsTransport } from '../codeMode/nats/CodeModeNatsTransport';
import { DEFAULT_SANDBOX_NATS_WS_PORT } from '../constants';
import { SandboxFileNotFoundError, SandboxFileTooLargeError, SandboxPathIsDirectoryError } from '../SandboxErrors';
import {
  ensureExecSuccess,
  type ExecResult,
  type SandboxBuild,
  type SandboxExecParams,
  type SandboxFileInfo,
  type SandboxProvider,
} from './Provider';

const DEFAULT_TIMEOUT_SECONDS = 60;
// Buffer for network latency + response processing on top of the server-side timeout.
const CLIENT_TIMEOUT_BUFFER_SECONDS = 5;

// Wraps a value in single quotes for safe use in shell commands.
// Inner single quotes are escaped via the standard shell idiom: ' → '\''
function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export interface TFYSandboxProviderOptions {
  serverUrl: string;
  natsBridgeUrl: string;
  tenantName: string;
  fileMaxBytesForDownload: number;
  defaultExecTimeoutMs?: number | undefined;
  logger: Logger;
}

interface StatResult {
  size: number;
  type: string;
}

export class TFYSandboxProvider implements SandboxProvider {
  private readonly serverUrl: string;
  private readonly natsBridgeUrl: string;
  private readonly tenantName: string;
  private readonly fileMaxBytesForDownload: number;
  private readonly defaultExecTimeoutSeconds: number;
  private readonly logger: Logger;

  constructor(options: TFYSandboxProviderOptions) {
    this.serverUrl = options.serverUrl.replace(/\/+$/, '');
    this.natsBridgeUrl = options.natsBridgeUrl;
    this.tenantName = options.tenantName;
    this.fileMaxBytesForDownload = options.fileMaxBytesForDownload;
    this.defaultExecTimeoutSeconds = Math.ceil((options.defaultExecTimeoutMs ?? DEFAULT_TIMEOUT_SECONDS * 1000) / 1000);
    this.logger = options.logger.child({ module: 'TFYSandboxProvider' });
  }

  // TFY sandboxes run a prebuilt server image with no per-image build step, so the image is always ready.
  private static readonly readyBuild: SandboxBuild = {
    status: 'ready',
    reason: null,
    metadata: null,
  };

  buildImage(): Promise<SandboxBuild> {
    return Promise.resolve(TFYSandboxProvider.readyBuild);
  }

  getImageBuildStatus(): Promise<SandboxBuild> {
    return Promise.resolve(TFYSandboxProvider.readyBuild);
  }

  createSandbox(): Promise<{ sandboxId: string }> {
    const sandboxId = `${this.tenantName}.${randomUUID()}`;
    this.logger.debug(`Sandbox created: id=${sandboxId}`);
    return Promise.resolve({ sandboxId });
  }

  async exec(params: SandboxExecParams): Promise<ExecResult> {
    return context.with(suppressTracing(context.active()), async (): Promise<ExecResult> => {
      // Honor the per-call timeout (e.g. the longer skill-download timeout) for both the server-side
      // request timeout and the client abort timer; fall back to the provider default otherwise.
      const timeoutSeconds = params.timeoutSeconds ?? this.defaultExecTimeoutSeconds;
      const body = {
        sandbox_id: params.sandboxId,
        command: params.command,
        cwd: params.cwd,
        env: params.env,
        timeout: timeoutSeconds,
      };

      const controller = new AbortController();
      const clientTimeoutMs = (timeoutSeconds + CLIENT_TIMEOUT_BUFFER_SECONDS) * 1000;
      const timer = setTimeout(() => {
        controller.abort();
      }, clientTimeoutMs);

      try {
        const response = await fetch(`${this.serverUrl}/exec`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text();
          this.logger.error(`Sandbox server returned ${String(response.status)}: ${text}`);
          return { success: false, error: `Sandbox server returned ${String(response.status)}: ${text}` };
        }

        const result = (await response.json()) as ExecResult;
        return result;
      } catch (e: unknown) {
        if (e instanceof Error && e.name === 'AbortError') {
          this.logger.error(`Sandbox exec timed out after ${String(timeoutSeconds)}s`, extractErrorLogFields(e));
          return { success: false, error: `Sandbox exec timed out after ${String(timeoutSeconds)}s` };
        }
        this.logger.error('Sandbox exec failed', extractErrorLogFields(e));
        const message = e instanceof Error ? e.message : 'Unknown error';
        return { success: false, error: message };
      } finally {
        clearTimeout(timer);
      }
    });
  }

  private async getFileInfo(params: { sandboxId: string; path: string }): Promise<SandboxFileInfo> {
    const result = await this.exec({
      sandboxId: params.sandboxId,
      command: `stat -L --printf='{"size":%s,"type":"%F"}' ${shellEscape(params.path)}`,
    });

    if (!result.success) {
      throw new Error(`Failed to stat file: ${result.error}`);
    }
    if (result.response.exitCode !== 0) {
      throw new SandboxFileNotFoundError(params.path);
    }

    const parsed = JSON.parse(result.response.result) as StatResult;
    return { size: parsed.size, isDir: parsed.type === 'directory' };
  }

  async downloadFile(params: { sandboxId: string; path: string }): Promise<Buffer> {
    const info = await this.getFileInfo(params);
    if (info.isDir) {
      throw new SandboxPathIsDirectoryError(params.path);
    }
    if (info.size > this.fileMaxBytesForDownload) {
      throw new SandboxFileTooLargeError(params.path, info.size, this.fileMaxBytesForDownload);
    }

    const result = await this.exec({
      sandboxId: params.sandboxId,
      command: `base64 -w0 ${shellEscape(params.path)}`,
    });

    if (!result.success) {
      throw new Error(`Failed to download file: ${result.error}`);
    }
    if (result.response.exitCode !== 0) {
      throw new SandboxFileNotFoundError(params.path);
    }

    return Buffer.from(result.response.result.trim(), 'base64');
  }

  async uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void> {
    const encoded = params.content.toString('base64');
    const escapedPath = shellEscape(params.remotePath);

    const result = await this.exec({
      sandboxId: params.sandboxId,
      command: `echo ${shellEscape(encoded)} | base64 -d > ${escapedPath}`,
    });
    ensureExecSuccess(result);
  }

  // The TFY sandbox exposes a static, cluster-internal NATS WebSocket URL (no signed URLs).
  createCodeModeTransport(): CodeModeTransport {
    return new CodeModeNatsTransport({
      resolveHostUrl: () => Promise.resolve(this.natsBridgeUrl),
      sandboxClientNatsUrl: `ws://localhost:${String(DEFAULT_SANDBOX_NATS_WS_PORT)}`,
      logger: this.logger,
    });
  }

  getAdditionalInstructions(): string {
    return dedent`
    SANDBOX RULES:
    - The Agent's first sandbox command should be \`pwd\` to discover the working directory.
    - ALL file creation and writes MUST stay within that working directory.
    - The Agent must NOT write to /tmp/, ~/, or any absolute path outside the working directory.
  `;
  }

  getToolResultDumpDir(sandboxId: string): string {
    return `/tmp/${sandboxId}/tool-results`;
  }

  getGitCredentialsPath(sandboxId: string): string {
    return `/tmp/${sandboxId}/.git-credentials`;
  }
}
