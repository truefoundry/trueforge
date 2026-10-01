import type { CodeModeTransport } from '../codeMode/CodeModeTransport';

/** Command executed in sandbox — exitCode may be non-zero but the infra call succeeded. */
export interface ExecSuccessResult {
  success: true;
  response: { exitCode: number; result: string };
}

/** Sandbox infrastructure failure — command never ran (e.g. network error, auth failure). */
export interface ExecErrorResult {
  success: false;
  error: string;
}

export type ExecResult = ExecSuccessResult | ExecErrorResult;

/**
 * Wraps a value in single quotes for safe use in a shell command. Inner single quotes are
 * escaped via the standard shell idiom: ' -> '\''. Use for any user-controlled value that is
 * interpolated into an exec command string.
 */
export function shellEscape(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

/** Throws if the exec result indicates failure (infra error or non-zero exit code). */
export function ensureExecSuccess(result: ExecResult): void {
  if (!result.success) {
    throw new Error(result.error);
  }
  if (result.response.exitCode !== 0) {
    throw new Error(`(exit code ${String(result.response.exitCode)}): ${result.response.result}`);
  }
}

export interface SandboxFileInfo {
  size: number;
  isDir: boolean;
}

/** Parameters for a single sandbox command. */
export interface SandboxExecParams {
  sandboxId: string;
  command: string;
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
  /** Overrides the provider's default exec timeout (e.g. for long skill downloads). */
  timeoutSeconds?: number | undefined;
}

/** File uploaded before a sandbox init command runs. */
export interface SandboxInitUpload {
  remotePath: string;
  content: Buffer;
}

/**
 * Init step from a producer (e.g. skill mounter).
 * Sandbox supplies `sandboxId` when it runs the command.
 */
export interface SandboxInit {
  command: string;
  env?: Record<string, string> | undefined;
  /** Exec timeout for this init command (seconds). Skill downloads use a long value. */
  timeoutSeconds: number;
  /** Files to upload before the init command runs (e.g. requested skills JSON). */
  uploads: readonly SandboxInitUpload[];
}

export type SandboxBuildStatus = 'pending' | 'ready' | 'failed';

/** Provider-specific opaque build metadata (string map). */
export type SandboxBuildMetadata = Record<string, string>;

export interface SandboxBuild {
  status: SandboxBuildStatus;
  /** Human-readable detail for the current status (shown to the user); null when ready. */
  reason: string | null;
  /** Provider-specific build details; null when the provider has none. */
  metadata: SandboxBuildMetadata | null;
}

/**
 * Sandbox backend. `TEnvironment` is provider-specific create/build input
 * (`DaytonaSandboxEnvironment` for Daytona; `undefined` when the provider has none).
 */
export interface SandboxProvider<TEnvironment = undefined> {
  /** Stable provider kind used in fancy sandbox ids and carry-forward (plain string). */
  readonly type: string;
  /**
   * Whether this provider uses sandbox environments (snapshot tip / build).
   * When false, env resolve and env-store builds are skipped.
   */
  readonly envSupported: boolean;
  /**
   * Optional credential/access probe. Providers that need none may omit or resolve immediately.
   */
  validateAccess?(): Promise<void>;
  /** Fresh sandbox; optional environment pins snapshot + create params. */
  createSandbox(environment?: TEnvironment): Promise<{ sandboxId: string }>;
  /** Env snapshot/image build. Only providers that have environments implement these. */
  build?(environment: TEnvironment): Promise<SandboxBuild>;
  getBuildStatus?(environment: TEnvironment): Promise<SandboxBuild>;
  exec(params: SandboxExecParams): Promise<ExecResult>;
  /** Provider-specific instructions appended to the agent system prompt. */
  getAdditionalInstructions(): string | undefined;
  /** Directory inside the sandbox where large tool responses are dumped. */
  getToolResultDumpDir(sandboxId: string): string;
  /**
   * Git credential-store file (absolute, or cwd-relative when exec cwd is the jail).
   * `GIT_CONFIG` `store --file` is relative to the git process cwd — providers that
   * return a relative path must make it absolute in their own `exec`.
   */
  getGitCredentialsPath(sandboxId: string): string;
  /** Directory for user-uploaded files (absolute, or cwd-relative when the provider has no global FS). */
  getFileUploadsDir(sandboxId: string): string;
  /** Directory where skill mounts are materialized. */
  getSkillsDir(sandboxId: string): string;
  /** Path the skill downloader script is written to before it runs. */
  getSkillDownloaderPath(sandboxId: string): string;
  /** Downloads a file from the sandbox as a Buffer. Throws SandboxFileNotFoundError / SandboxNotAvailableError / SandboxPathIsDirectoryError / SandboxFileTooLargeError. */
  downloadFile(params: { sandboxId: string; path: string }): Promise<Buffer>;
  /** Uploads a file to the sandbox. */
  uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void>;

  /**
   * Construct a Code Mode transport for this provider (no connect/listen yet).
   * Throws if the provider does not support Code Mode.
   */
  createCodeModeTransport(): CodeModeTransport;
}
