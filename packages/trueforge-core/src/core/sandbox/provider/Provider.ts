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

// An init command a producer (e.g. a skill mounter) hands to the Sandbox, which supplies `sandboxId`.
export type SandboxInit = Omit<SandboxExecParams, 'sandboxId'>;

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

/** An opened sandbox file ready to be streamed to a client. */
export interface SandboxFileDownload {
  /**
   * Byte count from the provider's pre-download stat. Drives the response Content-Length;
   * providers enforce this same bound again while streaming in case the file changed.
   */
  size: number;
  /**
   * File bytes, single consumption. Domain errors raised before the first byte propagate to the
   * caller as a rejected promise (mappable HTTP statuses); anything failing after that surfaces
   * as an errored stream — a truncated body the client can detect against Content-Length.
   */
  stream: ReadableStream<Uint8Array>;
}

export interface SandboxProvider {
  /** Stable provider kind used in fancy sandbox ids and carry-forward (plain string). */
  readonly type: string;
  /**
   * Ensures the release image is being built into the provider's backing store and
   * returns its current status. Idempotent: an already-built image reports `ready`;
   * a fresh build starts in the background and reports `pending`.
   */
  buildImage(): Promise<SandboxBuild>;
  /** Current build status of the release image. Read-only: never kicks off a build. */
  getImageBuildStatus(): Promise<SandboxBuild>;
  createSandbox(): Promise<{ sandboxId: string }>;
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
  /** Directory where git skills are materialized. */
  getSkillsDir(sandboxId: string): string;
  /** Path the git skill downloader script is written to before it runs. */
  getGitDownloaderPath(sandboxId: string): string;
  /**
   * Opens a file for streaming download. Implementations stat first (path checks, is-dir,
   * max-size) so domain errors reject before any byte moves, then hand back an incremental
   * stream — peak memory stays bounded by chunk size rather than file size.
   * `signal` aborts provider reads once the HTTP client goes away mid-stream.
   */
  downloadFile(params: {
    sandboxId: string;
    path: string;
    signal?: AbortSignal | undefined;
  }): Promise<SandboxFileDownload>;
  /** Uploads a file to the sandbox. */
  uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void>;

  /**
   * Construct a Code Mode transport for this provider (no connect/listen yet).
   * Throws if the provider does not support Code Mode.
   */
  createCodeModeTransport(): CodeModeTransport;
}
