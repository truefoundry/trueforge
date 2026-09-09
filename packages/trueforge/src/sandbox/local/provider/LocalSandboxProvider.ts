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
  absolutizeRelativeExecEnv,
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxNotAvailableError,
  SandboxPathIsDirectoryError,
  shellEscape,
  validateNoPathTraversal,
} from '@truefoundry/trueforge-core/core';
import { execFile } from 'node:child_process';
import { existsSync, realpathSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { Logger } from 'winston';
import { newId } from '../../../utils/id';
import {
  assertCodeModeSocketParentPath,
  CodeModeUdsTransport,
  probeCodeModeUnixSocket,
} from '../core/CodeModeUdsTransport.js';
import {
  checkSrtHostDependencies,
  createSandbox,
  initSrt,
  isSrtInitialized,
  removeSandbox,
  resetSrt,
  resolveCommandOnHost,
  resolvePythonExecutableOnHost,
  runSupervisorSession,
  SANDBOX_VENV_DIR,
  srtHostBinaryNames,
  type LocalSandboxPlatform,
  type SessionResult,
} from '../core/hostRun.js';
import { XferFileInfoSchema, type XferFileInfo } from '../schemas/xferFileInfo.js';

const execFileAsync = promisify(execFile);

const DEFAULT_EXEC_TIMEOUT_SECONDS = 60;
const DEFAULT_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Cap for isSupported shell/Python probes (not general exec). */
const SUPPORT_PROBE_TIMEOUT_MS = 5_000;
const VENV_CREATE_TIMEOUT_MS = 60_000;
const VENV_PIP_TIMEOUT_MS = 120_000;
/** Same pin as the Daytona image / git_downloader.py PEP 723 header. */
const VENV_PYDANTIC_PIN = 'pydantic>=2.0.0,<3.0.0';

/** Command names resolved via `command -v` (PATH from sandbox policy). */
const SHELL_CANDIDATES = ['bash', 'sh'] as const;
const PYTHON_CANDIDATES = ['python3', 'python'] as const;

export type { LocalSandboxPlatform };

/** One host/socket/shell/python candidate tried by {@link LocalSandboxProvider.isSupported}. */
export interface LocalSandboxSupportProbeAttempt {
  kind: 'host' | 'socket' | 'shell' | 'python';
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
    return attempt.kind === 'host' ? `${attempt.name}: not on PATH` : `${attempt.name}: not on sandbox PATH`;
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
   * Absolute existing directory for Code Mode UDS (≤65 bytes after realpath, mode 0700).
   * Caller owns its lifetime. Transport chmod's the parent to 0700 and each sock to 0600 after listen.
   */
  codeModeSocketParentPath: string;
  /** Result of {@link LocalSandboxProvider.isSupported}; must be `{ supported: true }`. */
  support: LocalSandboxSupportResult;
  fileMaxBytesForDownload?: number | undefined;
  defaultExecTimeoutSeconds?: number | undefined;
  logger: Logger;
}

/** Sandbox-relative path for sandboxed commands (avoids /var vs /private/var seatbelt mismatches). */
function toSandboxRelativePath(params: { sandboxRootPath: string; absolutePath: string }): string {
  const rel = relative(params.sandboxRootPath, params.absolutePath);
  return rel === '' ? '.' : rel;
}

/** True when `descendant` is a real path strictly inside `ancestor` (not equal, not a sibling prefix). */
function isStrictDescendant(params: { ancestor: string; descendant: string }): boolean {
  const rel = relative(params.ancestor, params.descendant);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function execFileErrorDetail(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const parts = [error.message];
  if ('stderr' in error && typeof error.stderr === 'string' && error.stderr.length > 0) {
    parts.push(error.stderr);
  }
  if ('stdout' in error && typeof error.stdout === 'string' && error.stdout.length > 0) {
    parts.push(error.stdout);
  }
  return parts.join(' ');
}

function sessionFailDetail(session: SessionResult): string {
  return [session.protocolError, session.stderrText, session.stdoutText]
    .filter(part => part !== undefined && part.length > 0)
    .join(' ');
}

/**
 * In-sandbox upload: create parent, re-open a 0555 file from a prior init, write with
 * `/bin/cat` (jail PATH prefers Homebrew; a stale Cellar `cat` is ENOENT).
 */
export function localSandboxUploadCommand(remotePath: string): string {
  const parent = dirname(remotePath);
  return [
    `mkdir -p ${shellEscape(parent)}`,
    `{ chmod u+w ${shellEscape(remotePath)} 2>/dev/null || true; }`,
    `/bin/cat > ${shellEscape(remotePath)}`,
  ].join(' && ');
}

export class LocalSandboxProvider implements SandboxProvider {
  readonly type = 'local';
  private readonly sandboxRootPathParent: string;
  private readonly codeModeSocketParentPath: string;
  private readonly support: LocalSandboxSupported;
  private readonly fileMaxBytesForDownload: number;
  private readonly defaultExecTimeoutSeconds: number;
  private srtInitialized = false;
  private readonly logger: Logger;

  /** Local SRT has no image build step — always ready. */
  private static readonly readyBuild: SandboxBuild = {
    status: 'ready',
    reason: null,
    metadata: null,
  };

  /**
   * Probe whether this host can run LocalSandboxProvider
   * (OS + Code Mode UDS listen + SRT host binaries + in-sandbox shell + Python 3).
   * On success, returns platform/shell/python to pass into the constructor as `support`.
   */
  static async isSupported(params?: { codeModeSocketParentPath?: string }): Promise<LocalSandboxSupportResult> {
    if (process.platform !== 'darwin' && process.platform !== 'linux') {
      return unsupported({
        reason: `LocalSandboxProvider supports macOS and Linux only (got ${process.platform})`,
      });
    }
    const platform: LocalSandboxPlatform = process.platform;

    let createdSocketParent: string | undefined;
    const socketParentPath = params?.codeModeSocketParentPath;
    try {
      const parentPath = socketParentPath ?? (await mkdtemp(join('/tmp', 'tfc-')));
      if (socketParentPath === undefined) {
        createdSocketParent = parentPath;
      }
      try {
        await probeCodeModeUnixSocket(parentPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return unsupported({
          platform,
          attempts: [{ kind: 'socket', name: 'uds', resolved: parentPath, protocolError: message }],
          reason: `Code Mode UDS listen failed: ${message}`,
        });
      }
    } finally {
      if (createdSocketParent !== undefined) {
        await rm(createdSocketParent, { recursive: true, force: true });
      }
    }

    const hostPath = process.env['PATH'];
    const hostAttempts: LocalSandboxSupportProbeAttempt[] = [];
    for (const name of srtHostBinaryNames(platform)) {
      const resolved = await resolveCommandOnHost({
        platform,
        name,
        ...(hostPath === undefined || hostPath.length === 0 ? {} : { pathEnv: hostPath }),
      });
      hostAttempts.push({ kind: 'host', name, resolved });
    }
    if (hostAttempts.some(attempt => attempt.resolved === undefined)) {
      const required = srtHostBinaryNames(platform).join(', ');
      return unsupported({
        platform,
        attempts: hostAttempts,
        reason: formatLocalSandboxSupportReason({
          summary: `SRT host dependencies missing (${platform}: ${required})`,
          attempts: hostAttempts,
        }),
      });
    }

    const srtDeps = await checkSrtHostDependencies();
    if (srtDeps.errors.length > 0) {
      return unsupported({
        platform,
        attempts: hostAttempts.length === 0 ? undefined : hostAttempts,
        reason: `SRT host dependencies failed: ${srtDeps.errors.join('; ')}`,
      });
    }

    const alreadyInitialized = isSrtInitialized();
    let probeRoot: string | undefined;
    const attempts: LocalSandboxSupportProbeAttempt[] = [...hostAttempts];
    const pythonAttempts: LocalSandboxSupportProbeAttempt[] = [];

    try {
      if (!alreadyInitialized) {
        await initSrt({
          platform,
          ...(socketParentPath === undefined ? {} : { codeModeSocketParentPath: socketParentPath }),
        });
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
    const resolvedParent = resolve(options.sandboxRootPathParent);
    this.sandboxRootPathParent =
      existsSync(resolvedParent) && statSync(resolvedParent).isDirectory()
        ? realpathSync(resolvedParent)
        : resolvedParent;
    // Same validation as CodeModeUdsTransport (absolute, exists, ≤65 bytes, realpath).
    this.codeModeSocketParentPath = assertCodeModeSocketParentPath(options.codeModeSocketParentPath);
    this.support = options.support;
    this.fileMaxBytesForDownload = options.fileMaxBytesForDownload ?? DEFAULT_FILE_MAX_BYTES;
    this.defaultExecTimeoutSeconds = options.defaultExecTimeoutSeconds ?? DEFAULT_EXEC_TIMEOUT_SECONDS;
    this.logger = options.logger.child({ module: 'LocalSandboxProvider' });
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
    await initSrt({
      platform: this.support.platform,
      codeModeSocketParentPath: this.codeModeSocketParentPath,
    });
    this.srtInitialized = true;
  }

  /** Missing, non-directory, or not a child of this provider's parent → recreate path in Sandbox. */
  private ensureSandboxRoot(sandboxRootPath: string): void {
    if (!isAbsolute(sandboxRootPath)) {
      throw new SandboxNotAvailableError(sandboxRootPath);
    }
    const resolved = resolve(sandboxRootPath);
    if (!existsSync(resolved) || !statSync(resolved).isDirectory()) {
      throw new SandboxNotAvailableError(sandboxRootPath);
    }
    const parentReal = existsSync(this.sandboxRootPathParent)
      ? realpathSync(this.sandboxRootPathParent)
      : this.sandboxRootPathParent;
    const realRoot = realpathSync(resolved);
    if (!isStrictDescendant({ ancestor: parentReal, descendant: realRoot })) {
      throw new SandboxNotAvailableError(sandboxRootPath);
    }
  }

  /**
   * Host `python -m venv` (stdlib only), then sandboxed pip for pydantic.
   * Idempotent: skip create when `.venv/bin/python` exists; skip pip when import works.
   */
  private async ensureVenv(sandboxRootPath: string): Promise<void> {
    const venvDir = join(sandboxRootPath, SANDBOX_VENV_DIR);
    const venvPython = join(venvDir, 'bin', 'python');
    if (!existsSync(venvPython)) {
      try {
        await execFileAsync(this.support.python, ['-m', 'venv', venvDir], { timeout: VENV_CREATE_TIMEOUT_MS });
      } catch (error) {
        throw new Error(`Failed to create sandbox ${SANDBOX_VENV_DIR}: ${execFileErrorDetail(error)}`, {
          cause: error,
        });
      }
    }

    const relPython = join(SANDBOX_VENV_DIR, 'bin', 'python');
    const relPip = join(SANDBOX_VENV_DIR, 'bin', 'pip');
    const check = await runSupervisorSession({
      sandboxRootPath,
      platform: this.support.platform,
      shell: this.support.shell,
      command: `${shellEscape(relPython)} -c ${shellEscape('import pydantic')}`,
      timeoutMs: SUPPORT_PROBE_TIMEOUT_MS,
    });
    if (check.protocolError !== undefined) {
      throw new Error(`Sandbox venv pydantic check failed: ${check.protocolError}`);
    }
    if (check.exitCode === 0) {
      return;
    }

    const install = await runSupervisorSession({
      sandboxRootPath,
      platform: this.support.platform,
      shell: this.support.shell,
      command: `${shellEscape(relPip)} install --trusted-host pypi.org --trusted-host files.pythonhosted.org ${shellEscape(VENV_PYDANTIC_PIN)}`,
      timeoutMs: VENV_PIP_TIMEOUT_MS,
    });
    if (install.protocolError !== undefined || install.exitCode !== 0 || install.timedOut) {
      throw new Error(
        `Failed to pip install ${VENV_PYDANTIC_PIN} into sandbox ${SANDBOX_VENV_DIR}: ${sessionFailDetail(install)}`,
      );
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

  async createSandbox(): Promise<{ sandboxId: string }> {
    await this.ensureSrt();
    const sandboxId = await createSandbox(join(this.sandboxRootPathParent, newId()));
    this.logger.info('LocalSandboxProvider created sandbox', {
      sandboxId,
      shell: this.support.shell,
      python: this.support.python,
    });
    await mkdir(join(sandboxId, this.getToolResultDumpDir()), { recursive: true, mode: 0o700 });
    await mkdir(join(sandboxId, this.getFileUploadsDir()), { recursive: true, mode: 0o700 });
    await mkdir(join(sandboxId, this.getSkillsDir()), { recursive: true, mode: 0o700 });
    await this.ensureVenv(sandboxId);
    return { sandboxId };
  }

  async exec(params: SandboxExecParams): Promise<ExecResult> {
    this.ensureSandboxRoot(params.sandboxId);
    try {
      await this.ensureSrt();
      await this.ensureVenv(params.sandboxId);
      const sandboxRootPath = params.sandboxId;
      const cwd =
        params.cwd === undefined || params.cwd === ''
          ? sandboxRootPath
          : this.resolveInSandboxRoot(sandboxRootPath, params.cwd);
      const timeoutSeconds = params.timeoutSeconds ?? this.defaultExecTimeoutSeconds;
      const env =
        params.env === undefined ? undefined : absolutizeRelativeExecEnv({ root: sandboxRootPath, env: params.env });
      const session = await runSupervisorSession({
        sandboxRootPath,
        platform: this.support.platform,
        shell: this.support.shell,
        command: params.command,
        cwd,
        ...(env === undefined ? {} : { env }),
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
      '- A Python virtualenv lives at .venv. `python` and `pip` on PATH are that environment; packages you `pip install` persist in this sandbox.',
      '- uploads, skills, and tool-results live in the sandbox working directory.',
      '- ALL file creation and writes MUST stay within the sandbox working directory.',
      '- The Agent must NOT write outside the working directory (including host home and /tmp).',
    ].join('\n');
  }

  // Cwd-relative: SRT cwd is the sandbox root. Init mkdir/ln and the agent prompt must not use
  // host-absolute paths — those contain spaces under macOS Application Support and lose quoting.
  //   uploads, skills, tool-results, git_downloader.py, .git-credentials, .venv
  //   mcp-client/mcp_client.py
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

  async downloadFile(params: { sandboxId: string; path: string }): Promise<Buffer> {
    this.ensureSandboxRoot(params.sandboxId);
    await this.ensureSrt();
    await this.ensureVenv(params.sandboxId);
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

  /** Payload on stdin so large uploads stay off argv. */
  async uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void> {
    this.ensureSandboxRoot(params.sandboxId);
    await this.ensureSrt();
    await this.ensureVenv(params.sandboxId);
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
      command: localSandboxUploadCommand(remotePath),
      stdin: params.content,
    });
    if (result.exitCode !== 0) {
      const detail = [result.stderrText, result.stdoutText].filter(part => part.length > 0).join(' ');
      throw new Error(
        detail.length > 0
          ? `upload ${params.remotePath} failed (exit ${String(result.exitCode)}): ${detail}`
          : `upload ${params.remotePath} failed (exit ${String(result.exitCode)})`,
      );
    }
  }

  createCodeModeTransport(): CodeModeTransport {
    return new CodeModeUdsTransport({
      codeModeSocketParentPath: this.codeModeSocketParentPath,
      clientRemotePath: () => join('mcp-client', 'mcp_client.py'),
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
