import { context } from '@opentelemetry/api';
import { suppressTracing } from '@opentelemetry/core';
import dedent from 'dedent';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path/posix';
import type { Logger } from 'winston';
import { extractErrorLogFields } from '../../util/errorLogFields';
import type { CodeModeTransport } from '../codeMode/CodeModeTransport';
import { CodeModeNatsTransport } from '../codeMode/nats/CodeModeNatsTransport';
import { DEFAULT_SANDBOX_NATS_WS_PORT } from '../constants';
import {
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxPathIsDirectoryError,
  validateSandboxOwnedByTenant,
} from '../SandboxErrors';
import { absolutizeRelativeExecEnv } from './execEnv';
import {
  ensureExecSuccess,
  shellEscape,
  type ExecResult,
  type SandboxBuild,
  type SandboxExecParams,
  type SandboxFileInfo,
  type SandboxProvider,
} from './Provider';

const DEFAULT_TIMEOUT_SECONDS = 60;
// Buffer for network latency + response processing on top of the server-side timeout.
const CLIENT_TIMEOUT_BUFFER_SECONDS = 5;

const TFY_MCP_CLIENT_BIN = 'mcp-client/bin';

/** Put the layout CLI first on PATH (cwd-relative; {@link absolutizeRelativeExecEnv} makes it absolute). */
export function withMcpClientOnPath(path: string): string {
  const rest = path.split(':').filter(part => part.length > 0 && part !== TFY_MCP_CLIENT_BIN);
  return rest.length === 0 ? TFY_MCP_CLIENT_BIN : `${TFY_MCP_CLIENT_BIN}:${rest.join(':')}`;
}

function parsePwdAndPath(text: string): { root: string; inheritedPath: string } | undefined {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const root = lines[0];
  if (!root?.startsWith('/')) {
    return undefined;
  }
  return { root, inheritedPath: lines[1] ?? '' };
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
  readonly type = 'tfy';
  private readonly serverUrl: string;
  private readonly natsBridgeUrl: string;
  private readonly tenantName: string;
  private readonly fileMaxBytesForDownload: number;
  private readonly defaultExecTimeoutSeconds: number;
  private readonly logger: Logger;
  /** Discovered via `pwd` + `$PATH` — never a hardcoded host layout. */
  private readonly sandboxLayouts = new Map<string, { root: string; inheritedPath: string }>();

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

  /**
   * No extra FS jail: exec cwd is the logical sandbox root. Layout getters are cwd-relative
   * so writes cannot escape it. `GIT_CONFIG` / PATH / PYTHONPATH must still be absolute so
   * git and `mcp-client` work after `cd` — resolved from `pwd` / `$PATH`, not a hardcoded prefix.
   */
  async exec(params: SandboxExecParams): Promise<ExecResult> {
    validateSandboxOwnedByTenant({ sandboxId: params.sandboxId, tenantName: this.tenantName });
    const { root, inheritedPath } = await this.sandboxLayout(params.sandboxId);
    const incoming = params.env ?? {};
    const env = absolutizeRelativeExecEnv({
      root,
      env: { ...incoming, PATH: withMcpClientOnPath(incoming['PATH'] ?? inheritedPath) },
    });
    return this.postExec({ ...params, env });
  }

  private async sandboxLayout(sandboxId: string): Promise<{ root: string; inheritedPath: string }> {
    const cached = this.sandboxLayouts.get(sandboxId);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.postExec({
      sandboxId,
      command: 'printf \'%s\\n%s\\n\' "$(pwd)" "$PATH"',
    });
    if (!result.success) {
      throw new Error(`Failed to resolve sandbox working directory: ${result.error}`);
    }
    const parsed = parsePwdAndPath(result.response.result);
    if (parsed === undefined) {
      throw new Error(`sandbox pwd did not return an absolute path: ${result.response.result}`);
    }
    this.sandboxLayouts.set(sandboxId, parsed);
    return parsed;
  }

  private async postExec(params: SandboxExecParams): Promise<ExecResult> {
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
      mcpClientInstall: { remotePath: join('mcp-client', 'mcp_client.py') },
    });
  }

  getAdditionalInstructions(): string {
    return dedent`
    SANDBOX RULES:
    - uploads, skills, and tool-results live in the sandbox working directory (not /tmp or /opt).
    - ALL file creation and writes MUST stay within the sandbox working directory.
    - The Agent must NOT write to /tmp/, ~/, or any absolute path outside the working directory.
  `;
  }

  // Cwd-relative (no FS jail). exec() pwd-joins GIT_CONFIG / PATH / PYTHONPATH.
  //   uploads, skills, tool-results, git_downloader.py, .git-credentials
  //   mcp-client/mcp_client.py  (no /usr/local/bin symlink)
  getToolResultDumpDir(): string {
    return 'tool-results';
  }

  getGitCredentialsPath(): string {
    return '.git-credentials';
  }

  getFileUploadsDir(): string {
    return 'uploads';
  }

  getSkillsDir(): string {
    return 'skills';
  }

  getGitDownloaderPath(): string {
    return 'git_downloader.py';
  }
}
