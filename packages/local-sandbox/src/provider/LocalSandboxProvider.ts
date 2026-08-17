/**
 * Local SRT SandboxProvider. Code Mode UDS is handle-scoped via {@link CodeModeUdsTransport}.
 */
import type {
  CodeModeTransport,
  ExecResult,
  SandboxBuild,
  SandboxExecParams,
  SandboxProvider,
} from '@truefoundry/trueforge-core/core';
import {
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxPathIsDirectoryError,
  shellEscape,
  validateNoPathTraversal,
} from '@truefoundry/trueforge-core/core';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { ulid } from 'ulid';
import { CodeModeUdsTransport, assertCodeModeSocketParentPath } from '../core/CodeModeUdsTransport.js';
import {
  createSandbox,
  initSrt,
  isSrtInitialized,
  removeSandbox,
  resetSrt,
  resolveCommandOnHost,
  runSupervisorSession,
  type LocalSandboxPlatform,
} from '../core/hostRun.js';
import { XferFileInfoSchema, type XferFileInfo } from '../schemas/xferFileInfo.js';

const DEFAULT_EXEC_TIMEOUT_SECONDS = 60;
const DEFAULT_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Cap for isSupported shell/Python probes (not general exec). */
const SUPPORT_PROBE_TIMEOUT_MS = 5_000;

/** Command names resolved via `command -v` (PATH from sandbox policy). */
const SHELL_CANDIDATES = ['bash', 'sh'] as const;
const PYTHON_CANDIDATES = ['python3', 'python'] as const;

export type { LocalSandboxPlatform };

export type LocalSandboxSupportResult =
  | { supported: true; platform: LocalSandboxPlatform; shell: string; python: string }
  | { supported: false; reason: string };

type LocalSandboxSupported = Extract<LocalSandboxSupportResult, { supported: true }>;

export interface LocalSandboxProviderOptions {
  /** Absolute parent directory under which each createSandbox makes a ULID child root. */
  sandboxRootPathParent: string;
  /**
   * Absolute existing directory for Code Mode UDS (≤60 bytes, mode 0700). Caller owns its lifetime.
   * Transport chmod's the parent to 0700 and each sock to 0600 after listen.
   */
  codeModeSocketParentPath: string;
  /** Result of {@link LocalSandboxProvider.isSupported}; must be `{ supported: true }`. */
  support: LocalSandboxSupportResult;
  fileMaxBytesForDownload?: number | undefined;
  defaultExecTimeoutSeconds?: number | undefined;
}

/** Sandbox-relative path for sandboxed commands (avoids /var vs /private/var seatbelt mismatches). */
function sandboxRelativePath(userPath: string): string {
  return userPath.replace(/^\.\/+/, '');
}

export class LocalSandboxProvider implements SandboxProvider {
  private readonly sandboxRootPathParent: string;
  private readonly codeModeSocketParentPath: string;
  private readonly support: LocalSandboxSupported;
  private readonly fileMaxBytesForDownload: number;
  private readonly defaultExecTimeoutSeconds: number;
  private srtInitialized = false;

  /** Local SRT has no image build step — always ready. */
  private static readonly readyBuild: SandboxBuild = {
    status: 'ready',
    reason: null,
    metadata: null,
  };

  /**
   * Probe whether this host can run LocalSandboxProvider (OS + in-sandbox shell + Python 3).
   * On success, returns platform/shell/python to pass into the constructor as `support`.
   */
  static async isSupported(): Promise<LocalSandboxSupportResult> {
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
      return {
        supported: false,
        reason: `LocalSandboxProvider supports macOS and Linux only (got ${process.platform})`,
      };
    }
    const platform: LocalSandboxPlatform = process.platform;

    const alreadyInitialized = isSrtInitialized();
    let probeRoot: string | undefined;

    try {
      if (!alreadyInitialized) {
        await initSrt({ platform });
      }

      probeRoot = await createSandbox(await mkdtemp(join(tmpdir(), 'tfy-local-sandbox-support-')));

      let shell: string | undefined;
      for (const name of SHELL_CANDIDATES) {
        const resolved = await resolveCommandOnHost({ platform, name });
        if (resolved === undefined) {
          continue;
        }
        const probe = await runSupervisorSession({
          sandboxRootPath: probeRoot,
          platform,
          shell: resolved,
          command: 'echo shell-ok',
          timeoutMs: SUPPORT_PROBE_TIMEOUT_MS,
        });
        if (probe.protocolError === undefined && probe.exitCode === 0 && probe.stdoutText.includes('shell-ok')) {
          shell = resolved;
          break;
        }
      }
      if (shell === undefined) {
        return {
          supported: false,
          reason: 'No usable shell in sandbox (bash or sh via command -v)',
        };
      }

      let python: string | undefined;
      for (const name of PYTHON_CANDIDATES) {
        const resolved = await resolveCommandOnHost({ platform, name });
        if (resolved === undefined) {
          continue;
        }
        const probe = await runSupervisorSession({
          sandboxRootPath: probeRoot,
          platform,
          shell,
          command: `${shellEscape(resolved)} -c ${shellEscape(
            'import sys; raise SystemExit(0 if sys.version_info[0] == 3 else 1)',
          )}`,
          timeoutMs: SUPPORT_PROBE_TIMEOUT_MS,
        });
        if (probe.protocolError === undefined && probe.exitCode === 0) {
          python = resolved;
          break;
        }
      }
      if (python === undefined) {
        return {
          supported: false,
          reason: 'No usable Python 3 interpreter in sandbox (python3 or python via command -v)',
        };
      }

      return { supported: true, platform, shell, python };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { supported: false, reason: message };
    } finally {
      if (probeRoot !== undefined) {
        await removeSandbox(probeRoot);
      }
      if (!alreadyInitialized) {
        await resetSrt();
      }
    }
  }

  constructor(options: LocalSandboxProviderOptions) {
    if (!options.support.supported) {
      throw new Error(`LocalSandboxProvider is not supported: ${options.support.reason}`);
    }
    if (!isAbsolute(options.sandboxRootPathParent)) {
      throw new Error('sandboxRootPathParent must be an absolute path');
    }
    validateNoPathTraversal(options.sandboxRootPathParent);
    this.sandboxRootPathParent = resolve(options.sandboxRootPathParent);
    // Same validation as CodeModeUdsTransport (absolute, exists, ≤60 bytes, realpath).
    this.codeModeSocketParentPath = assertCodeModeSocketParentPath(options.codeModeSocketParentPath);
    this.support = options.support;
    this.fileMaxBytesForDownload = options.fileMaxBytesForDownload ?? DEFAULT_FILE_MAX_BYTES;
    this.defaultExecTimeoutSeconds = options.defaultExecTimeoutSeconds ?? DEFAULT_EXEC_TIMEOUT_SECONDS;
  }

  private pythonC(code: string, relPath: string): string {
    return `${this.support.python} -c ${shellEscape(code)} ${shellEscape(relPath)}`;
  }

  private statCommand(relPath: string): string {
    const code = [
      'import json, os, sys',
      'p = sys.argv[1]',
      'st = os.stat(p)',
      'print(json.dumps({"size": st.st_size, "isDir": os.path.isdir(p)}))',
    ].join('\n');
    return this.pythonC(code, relPath);
  }

  private base64EncodeCommand(relPath: string): string {
    const code = [
      'import base64, sys',
      'p = sys.argv[1]',
      'sys.stdout.write(base64.b64encode(open(p, "rb").read()).decode("ascii"))',
    ].join('\n');
    return this.pythonC(code, relPath);
  }

  buildImage(): Promise<SandboxBuild> {
    return Promise.resolve(LocalSandboxProvider.readyBuild);
  }

  getImageBuildStatus(): Promise<SandboxBuild> {
    return Promise.resolve(LocalSandboxProvider.readyBuild);
  }

  private async ensureSrt(): Promise<void> {
    if (this.srtInitialized) {
      return;
    }
    await initSrt({ platform: this.support.platform });
    this.srtInitialized = true;
  }

  private resolveInSandboxRoot(sandboxRootPath: string, userPath: string): string {
    validateNoPathTraversal(userPath);
    const resolved = userPath.startsWith('/') ? resolve(userPath) : resolve(sandboxRootPath, userPath);
    const root = resolve(sandboxRootPath);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new SandboxFileNotFoundError(userPath);
    }
    return resolved;
  }

  private async runSandboxCommand(params: {
    sandboxRootPath: string;
    command: string;
    stdin?: Buffer;
  }): Promise<{ exitCode: number; stdoutText: string; stderrText: string }> {
    const session = await runSupervisorSession({
      sandboxRootPath: params.sandboxRootPath,
      platform: this.support.platform,
      shell: this.support.shell,
      command: params.command,
      ...(params.stdin === undefined ? {} : { stdin: params.stdin }),
      timeoutMs: this.defaultExecTimeoutSeconds * 1000,
    });
    if (session.protocolError !== undefined) {
      throw new Error(session.protocolError);
    }
    return {
      exitCode: session.exitCode,
      stdoutText: session.stdoutText,
      stderrText: session.stderrText,
    };
  }

  private async getFileInfo(params: {
    sandboxRootPath: string;
    relPath: string;
    userPath: string;
  }): Promise<XferFileInfo> {
    const result = await this.runSandboxCommand({
      sandboxRootPath: params.sandboxRootPath,
      command: this.statCommand(params.relPath),
    });
    if (result.exitCode !== 0) {
      throw new SandboxFileNotFoundError(params.userPath);
    }
    return XferFileInfoSchema.parse(JSON.parse(result.stdoutText.trim()));
  }

  async createSandbox(): Promise<{ sandboxId: string }> {
    await this.ensureSrt();
    const sandboxId = await createSandbox(join(this.sandboxRootPathParent, ulid().toLowerCase()));
    await mkdir(join(sandboxId, 'tool-results'), { recursive: true, mode: 0o700 });
    await mkdir(join(sandboxId, 'uploads'), { recursive: true, mode: 0o700 });
    return { sandboxId };
  }

  async exec(params: SandboxExecParams): Promise<ExecResult> {
    try {
      await this.ensureSrt();
      const sandboxRootPath = params.sandboxId;
      const cwd =
        params.cwd === undefined || params.cwd === ''
          ? sandboxRootPath
          : this.resolveInSandboxRoot(sandboxRootPath, params.cwd);
      const timeoutSeconds = params.timeoutSeconds ?? this.defaultExecTimeoutSeconds;
      const session = await runSupervisorSession({
        sandboxRootPath,
        platform: this.support.platform,
        shell: this.support.shell,
        command: params.command,
        cwd,
        ...(params.env === undefined ? {} : { env: params.env }),
        timeoutMs: timeoutSeconds * 1000,
      });
      if (session.protocolError !== undefined) {
        return { success: false, error: session.protocolError };
      }
      const result = session.stdoutText + (session.stderrText ? session.stderrText : '');
      return {
        success: true,
        response: { exitCode: session.exitCode, result },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { success: false, error: message };
    }
  }

  getAdditionalInstructions(): string {
    return [
      'SANDBOX RULES:',
      `- Platform: ${this.support.platform}.`,
      `- Commands run under the sandbox shell: ${this.support.shell}.`,
      `- Python 3 is available as: ${this.support.python}. Prefer this binary for Python scripts.`,
      "- The Agent's first sandbox command should be `pwd` to discover the working directory.",
      '- ALL file creation and writes MUST stay within that working directory.',
      '- The Agent must NOT write outside the working directory (including host home and /tmp).',
    ].join('\n');
  }

  getToolResultDumpDir(sandboxId: string): string {
    return join(sandboxId, 'tool-results');
  }

  getGitCredentialsPath(sandboxId: string): string {
    return join(sandboxId, '.git-credentials');
  }

  async downloadFile(params: { sandboxId: string; path: string }): Promise<Buffer> {
    await this.ensureSrt();
    const sandboxRootPath = params.sandboxId;
    this.resolveInSandboxRoot(sandboxRootPath, params.path);
    const relPath = sandboxRelativePath(params.path);
    const info = await this.getFileInfo({ sandboxRootPath, relPath, userPath: params.path });
    if (info.isDir) {
      throw new SandboxPathIsDirectoryError(params.path);
    }
    if (info.size > this.fileMaxBytesForDownload) {
      throw new SandboxFileTooLargeError(params.path, info.size, this.fileMaxBytesForDownload);
    }
    const result = await this.runSandboxCommand({
      sandboxRootPath,
      command: this.base64EncodeCommand(relPath),
    });
    if (result.exitCode !== 0) {
      throw new SandboxFileNotFoundError(params.path);
    }
    const buf = Buffer.from(result.stdoutText.trim(), 'base64');
    if (buf.length > this.fileMaxBytesForDownload) {
      throw new SandboxFileTooLargeError(params.path, buf.length, this.fileMaxBytesForDownload);
    }
    return buf;
  }

  /** Payload on stdin so large uploads stay off argv. */
  async uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void> {
    await this.ensureSrt();
    if (params.content.length > this.fileMaxBytesForDownload) {
      throw new SandboxFileTooLargeError(params.remotePath, params.content.length, this.fileMaxBytesForDownload);
    }
    const sandboxRootPath = params.sandboxId;
    // Resolve for traversal checks, but pass sandbox-relative paths to the shell.
    // Absolute /var/folders/... paths lose quoting under SRT and become mkdir /var.
    this.resolveInSandboxRoot(sandboxRootPath, params.remotePath);
    const remotePath = sandboxRelativePath(params.remotePath);
    const parent = dirname(remotePath);
    const mkdirPart = parent === '.' ? '' : `mkdir -p ${shellEscape(parent)} && `;
    const result = await this.runSandboxCommand({
      sandboxRootPath,
      command: `${mkdirPart}cat > ${shellEscape(remotePath)}`,
      stdin: params.content,
    });
    if (result.exitCode !== 0) {
      throw new SandboxFileNotFoundError(params.remotePath);
    }
  }

  createCodeModeTransport(): CodeModeTransport {
    return new CodeModeUdsTransport({
      codeModeSocketParentPath: this.codeModeSocketParentPath,
    });
  }

  /** Reset process-scoped SRT for this provider. */
  async dispose(): Promise<void> {
    if (this.srtInitialized) {
      await resetSrt();
      this.srtInitialized = false;
    }
  }
}
