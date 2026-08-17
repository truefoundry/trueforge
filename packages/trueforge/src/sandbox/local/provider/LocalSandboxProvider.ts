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
  SandboxNotAvailableError,
  SandboxPathIsDirectoryError,
  shellEscape,
  validateNoPathTraversal,
} from '@truefoundry/trueforge-core/core';
import { existsSync, statSync } from 'node:fs';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { ulid } from 'ulid';
import { CodeModeUdsTransport, assertCodeModeSocketParentPath } from '../core/CodeModeUdsTransport.js';
import {
  createSandbox,
  initSrt,
  isSrtInitialized,
  removeSandbox,
  resetSrt,
  resolveCommandOnHost,
  resolvePythonExecutableOnHost,
  runSupervisorSession,
  type LocalSandboxPlatform,
  type SessionResult,
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

/** One shell/python candidate tried by {@link LocalSandboxProvider.isSupported}. */
export interface LocalSandboxSupportProbeAttempt {
  kind: 'shell' | 'python';
  name: string;
  resolved: string | undefined;
  executable?: string | undefined;
  exitCode?: number | undefined;
  stdout?: string | undefined;
  stderr?: string | undefined;
  protocolError?: string | undefined;
  timedOut?: boolean | undefined;
}

export type LocalSandboxSupportResult =
  | { supported: true; platform: LocalSandboxPlatform; shell: string; python: string }
  | {
      supported: false;
      reason: string;
      platform?: LocalSandboxPlatform | undefined;
      attempts?: readonly LocalSandboxSupportProbeAttempt[] | undefined;
    };

export function formatLocalSandboxSupportReason(params: {
  summary: string;
  attempts: readonly LocalSandboxSupportProbeAttempt[];
}): string {
  const details = params.attempts.map(formatLocalSandboxSupportAttempt).join('; ');
  return details.length === 0 ? params.summary : `${params.summary}: ${details}`;
}

function formatLocalSandboxSupportAttempt(attempt: LocalSandboxSupportProbeAttempt): string {
  if (attempt.resolved === undefined) {
    return `${attempt.name}: not on sandbox PATH`;
  }
  const parts = [`${attempt.name}: resolved=${attempt.resolved}`];
  if (attempt.executable !== undefined && attempt.executable !== attempt.resolved) {
    parts.push(`executable=${attempt.executable}`);
  }
  if (attempt.protocolError !== undefined) {
    parts.push(`protocolError=${attempt.protocolError}`);
  }
  if (attempt.exitCode !== undefined) {
    parts.push(`exit=${String(attempt.exitCode)}`);
  }
  if (attempt.timedOut === true) {
    parts.push('timedOut');
  }
  if (attempt.stderr !== undefined && attempt.stderr.length > 0) {
    parts.push(`stderr=${JSON.stringify(attempt.stderr)}`);
  }
  if (attempt.stdout !== undefined && attempt.stdout.length > 0) {
    parts.push(`stdout=${JSON.stringify(attempt.stdout)}`);
  }
  return parts.join(' ');
}

function probeAttemptFromSession(params: {
  kind: 'shell' | 'python';
  name: string;
  resolved: string;
  executable?: string | undefined;
  session: SessionResult;
}): LocalSandboxSupportProbeAttempt {
  return {
    kind: params.kind,
    name: params.name,
    resolved: params.resolved,
    ...(params.executable === undefined ? {} : { executable: params.executable }),
    exitCode: params.session.exitCode,
    stdout: params.session.stdoutText,
    stderr: params.session.stderrText,
    ...(params.session.protocolError === undefined ? {} : { protocolError: params.session.protocolError }),
    timedOut: params.session.timedOut,
  };
}

function unsupported(params: {
  reason: string;
  platform?: LocalSandboxPlatform | undefined;
  attempts?: readonly LocalSandboxSupportProbeAttempt[] | undefined;
}): Extract<LocalSandboxSupportResult, { supported: false }> {
  return {
    supported: false,
    reason: params.reason,
    ...(params.platform === undefined ? {} : { platform: params.platform }),
    ...(params.attempts === undefined ? {} : { attempts: params.attempts }),
  };
}

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
function toSandboxRelativePath(params: { sandboxRootPath: string; absolutePath: string }): string {
  const rel = relative(params.sandboxRootPath, params.absolutePath);
  return rel === '' ? '.' : rel;
}

/** Single path segment under the sandboxes parent (`_` when sessionId is missing or unsafe). */
export function localSandboxSessionSegment(sessionId: string | undefined): string {
  if (sessionId === undefined || sessionId.length === 0 || sessionId.includes('/') || sessionId.includes('..')) {
    return '_';
  }
  return sessionId;
}

export class LocalSandboxProvider implements SandboxProvider {
  readonly type = 'local';
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
      return unsupported({
        reason: `LocalSandboxProvider supports macOS and Linux only (got ${process.platform})`,
      });
    }
    const platform: LocalSandboxPlatform = process.platform;

    const alreadyInitialized = isSrtInitialized();
    let probeRoot: string | undefined;
    const attempts: LocalSandboxSupportProbeAttempt[] = [];
    const pythonAttempts: LocalSandboxSupportProbeAttempt[] = [];

    try {
      if (!alreadyInitialized) {
        await initSrt({ platform });
      }

      probeRoot = await createSandbox(await mkdtemp(join(tmpdir(), 'tfy-local-sandbox-support-')));

      let shell: string | undefined;
      for (const name of SHELL_CANDIDATES) {
        const resolved = await resolveCommandOnHost({ platform, name });
        if (resolved === undefined) {
          attempts.push({ kind: 'shell', name, resolved: undefined });
          continue;
        }
        const probe = await runSupervisorSession({
          sandboxRootPath: probeRoot,
          platform,
          shell: resolved,
          command: 'echo shell-ok',
          timeoutMs: SUPPORT_PROBE_TIMEOUT_MS,
        });
        const attempt = probeAttemptFromSession({ kind: 'shell', name, resolved, session: probe });
        if (probe.protocolError === undefined && probe.exitCode === 0 && probe.stdoutText.includes('shell-ok')) {
          shell = resolved;
          break;
        }
        attempts.push(attempt);
      }
      if (shell === undefined) {
        return unsupported({
          platform,
          attempts,
          reason: formatLocalSandboxSupportReason({
            summary: 'No usable shell in sandbox (bash or sh via command -v)',
            attempts,
          }),
        });
      }

      let python: string | undefined;
      for (const name of PYTHON_CANDIDATES) {
        const resolved = await resolveCommandOnHost({ platform, name });
        if (resolved === undefined) {
          pythonAttempts.push({ kind: 'python', name, resolved: undefined });
          continue;
        }
        // Prefer the host-resolved interpreter so macOS stubs/symlinks are not
        // executed under seatbelt (xcode-select, python.org /usr/local/bin).
        const executable = (await resolvePythonExecutableOnHost({ commandPath: resolved })) ?? resolved;
        const probe = await runSupervisorSession({
          sandboxRootPath: probeRoot,
          platform,
          shell,
          command: `${shellEscape(executable)} -c ${shellEscape(
            'import sys; raise SystemExit(0 if sys.version_info[0] == 3 else 1)',
          )}`,
          timeoutMs: SUPPORT_PROBE_TIMEOUT_MS,
        });
        const attempt = probeAttemptFromSession({
          kind: 'python',
          name,
          resolved,
          executable,
          session: probe,
        });
        if (probe.protocolError === undefined && probe.exitCode === 0) {
          python = executable;
          break;
        }
        pythonAttempts.push(attempt);
      }
      if (python === undefined) {
        return unsupported({
          platform,
          attempts: pythonAttempts,
          reason: formatLocalSandboxSupportReason({
            summary: 'No usable Python 3 interpreter in sandbox (python3 or python via command -v)',
            attempts: pythonAttempts,
          }),
        });
      }

      return { supported: true, platform, shell, python };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const seen = [...attempts, ...pythonAttempts];
      return unsupported({
        platform,
        attempts: seen.length === 0 ? undefined : seen,
        reason:
          seen.length === 0
            ? message
            : `${message}: ${formatLocalSandboxSupportReason({ summary: 'probe aborted', attempts: seen })}`,
      });
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

  /** Missing or non-directory root → recreate path in Sandbox. */
  private ensureSandboxRoot(sandboxRootPath: string): void {
    if (!isAbsolute(sandboxRootPath) || !existsSync(sandboxRootPath) || !statSync(sandboxRootPath).isDirectory()) {
      throw new SandboxNotAvailableError(sandboxRootPath);
    }
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

  async createSandbox(params?: { sessionId?: string }): Promise<{ sandboxId: string }> {
    await this.ensureSrt();
    const sandboxId = await createSandbox(
      join(this.sandboxRootPathParent, localSandboxSessionSegment(params?.sessionId), ulid().toLowerCase()),
    );
    await mkdir(this.getToolResultDumpDir(sandboxId), { recursive: true, mode: 0o700 });
    await mkdir(this.getFileUploadsDir(sandboxId), { recursive: true, mode: 0o700 });
    await mkdir(this.getSkillsDir(sandboxId), { recursive: true, mode: 0o700 });
    return { sandboxId };
  }

  async exec(params: SandboxExecParams): Promise<ExecResult> {
    this.ensureSandboxRoot(params.sandboxId);
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
      if (error instanceof SandboxNotAvailableError) {
        throw error;
      }
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

  getFileUploadsDir(sandboxId: string): string {
    return join(sandboxId, 'uploads');
  }

  getSkillsDir(sandboxId: string): string {
    return join(sandboxId, 'skills');
  }

  getGitDownloaderPath(sandboxId: string): string {
    return join(sandboxId, 'git_downloader.py');
  }

  async downloadFile(params: { sandboxId: string; path: string }): Promise<Buffer> {
    this.ensureSandboxRoot(params.sandboxId);
    await this.ensureSrt();
    const sandboxRootPath = params.sandboxId;
    const absolutePath = this.resolveInSandboxRoot(sandboxRootPath, params.path);
    const relPath = toSandboxRelativePath({ sandboxRootPath, absolutePath });
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

  /** Payload on stdin so large uploads stay off argv. Parent dirs must already exist. */
  async uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void> {
    this.ensureSandboxRoot(params.sandboxId);
    await this.ensureSrt();
    if (params.content.length > this.fileMaxBytesForDownload) {
      throw new SandboxFileTooLargeError(params.remotePath, params.content.length, this.fileMaxBytesForDownload);
    }
    const sandboxRootPath = params.sandboxId;
    // Resolve for traversal checks, but pass sandbox-relative paths to the shell.
    // Absolute /var/folders/... paths lose quoting under SRT and become mkdir /var.
    const absolutePath = this.resolveInSandboxRoot(sandboxRootPath, params.remotePath);
    const remotePath = toSandboxRelativePath({ sandboxRootPath, absolutePath });
    const result = await this.runSandboxCommand({
      sandboxRootPath,
      command: `cat > ${shellEscape(remotePath)}`,
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
