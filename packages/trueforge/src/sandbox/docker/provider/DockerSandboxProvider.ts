/**
 * Container-backed SandboxProvider.
 *
 * One container per sandbox, addressed by the absolute working directory inside
 * it. That choice matters for two reasons:
 *
 *  - The provider contract requires `pwd` to print the sandbox id, so the id has
 *    to *be* a path rather than a container name.
 *  - An absolute id activates the path-id branch of the shared contract suite,
 *    which asserts that one sandbox cannot reach a sibling by `../` or by
 *    absolute path. Separate containers satisfy that structurally: the sibling
 *    path does not exist in the other mount namespace.
 *
 * The sandbox is an image, which is the point: a workload that needs a specific
 * CUDA or Python toolchain gets a reproducible one, which a host-process sandbox
 * cannot offer. `gpus` maps onto `--gpus` so the container toolkit does the device
 * and driver plumbing.
 *
 * File transfer goes through `docker exec` with a piped stdin/stdout rather than
 * encoding payloads into a command string. Encoding into argv caps out around
 * 96 KiB on `MAX_ARG_STRLEN` / `E2BIG` (see upstream issue #416), and a sandbox
 * that cannot accept a file larger than a small source file is not much use.
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
import { spawn } from 'node:child_process';
import { posix, resolve, sep } from 'node:path';
import { ulid } from 'ulid';
import type { Logger } from 'winston';

/** Parent directory of every sandbox root inside the container. */
const SANDBOX_PARENT = '/sandbox';
const DEFAULT_EXEC_TIMEOUT_SECONDS = 60;
const DEFAULT_FILE_MAX_BYTES = 10 * 1024 * 1024;
/** Cap for `docker version` / `docker image inspect` probes, not general exec. */
const PROBE_TIMEOUT_MS = 10_000;
const CONTAINER_NAME_PREFIX = 'tfy-sbx-';
/** Slack between the in-container timeout and the outer client kill. */
const OUTER_TIMEOUT_GRACE_MS = 10_000;
/** Marks containers this provider owns, so stale ones can be found and reaped. */
const OWNER_LABEL = 'com.truefoundry.trueforge.sandbox';
/**
 * Narrows ownership below "any TrueForge sandbox on this daemon".
 *
 * Without it a reaper can only operate globally, which makes it a footgun rather
 * than a tool: a second server, another developer, or a test run sharing the
 * daemon would have its live sandboxes deleted. Every reap is scoped, and a scope
 * is required rather than defaulted at the call site.
 */
const SCOPE_LABEL = 'com.truefoundry.trueforge.sandbox.scope';
const DEFAULT_SCOPE = 'default';
/** Sandbox ids are ULIDs lowercased; anything else is not one of ours. */
const SANDBOX_SLUG_RE = /^[0-9a-z]{26}$/;

/**
 * In-flight and failed image pulls, keyed by image reference.
 *
 * Deliberately module-scoped rather than per-instance: the server constructs a
 * fresh provider for every turn (see `resolveSandboxProvider`), so instance state
 * would make a pull started by the settings PUT invisible to the next caller,
 * which would then start a second pull and never observe the first one's failure.
 * Process-scoped is the correct lifetime for "is this image being fetched".
 */
const pullState = new Map<string, { inFlight: Promise<void> | undefined; failure: string | undefined }>();

export interface DockerSandboxProviderOptions {
  /** Image the sandbox runs. Must provide a POSIX shell and `python3`. */
  image: string;
  logger: Logger;
  /** `docker` by default; set to `podman` or an absolute path to override. */
  dockerBinary?: string;
  /**
   * Value passed to `--gpus`, e.g. `all` or `device=0`. Omitted means no GPU,
   * which is the right default: attaching a GPU to a sandbox that does not need
   * one wastes a scarce device and slows container start.
   */
  gpus?: string;
  /**
   * Ownership scope for containers this provider creates. Only a reaper given the
   * same scope will remove them, so two servers (or a test run and a dev server)
   * sharing one daemon cannot delete each other's live sandboxes.
   */
  scope?: string;
  execTimeoutSeconds?: number;
  fileMaxBytesForDownload?: number;
  /**
   * Extra `docker run` arguments. Intended for read-only host mounts such as a
   * CUDA toolkit, so the image can stay small. Never interpolated through a
   * shell.
   */
  extraRunArgs?: readonly string[];
}

export type DockerSandboxSupportResult = { supported: true; version: string } | { supported: false; reason: string };

interface RunResult {
  exitCode: number;
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  /**
   * The process was killed because stdout passed `maxStdoutBytes`. Distinct from
   * an exit code: the child is killed mid-stream, so its status says nothing about
   * why. Without this flag an oversized download is indistinguishable from a
   * missing file.
   */
  outputCapExceeded: boolean;
}

/**
 * Thrown when Code Mode is requested on a provider that has no transport for it.
 * Typed so a caller can detect it and decline the capability, rather than having
 * to string-match a generic Error at the point the agent already committed.
 */
export class CodeModeUnsupportedError extends Error {
  readonly providerType: string;

  constructor(providerType: string) {
    super(`sandbox provider "${providerType}" does not support Code Mode`);
    this.name = 'CodeModeUnsupportedError';
    this.providerType = providerType;
  }
}

export class DockerSandboxProvider implements SandboxProvider {
  readonly type = 'docker';
  /**
   * Code Mode needs a bidirectional transport between harness and sandbox. The
   * local provider uses a unix socket on a shared filesystem, which a container
   * does not have by construction. Declared false so the session degrades to
   * ordinary tool calls instead of constructing a transport that throws.
   */
  readonly supportsCodeMode = false;

  private readonly image: string;
  private readonly dockerBinary: string;
  private readonly gpus: string | undefined;
  private readonly execTimeoutSeconds: number;
  private readonly fileMaxBytesForDownload: number;
  private readonly extraRunArgs: readonly string[];
  private readonly scope: string;
  private readonly logger: Logger;

  /**
   * Sandbox ids created by *this* instance, for `dispose()` only. It is not a
   * lookup table: the container name is derived from the sandbox id, so a
   * provider built in a later turn can still address a sandbox it did not create.
   */
  private readonly ownCreations = new Set<string>();

  private static readonly readyBuild: SandboxBuild = { status: 'ready', reason: null, metadata: null };

  constructor(options: DockerSandboxProviderOptions) {
    this.image = options.image;
    this.dockerBinary = options.dockerBinary ?? 'docker';
    this.gpus = options.gpus;
    this.execTimeoutSeconds = options.execTimeoutSeconds ?? DEFAULT_EXEC_TIMEOUT_SECONDS;
    this.fileMaxBytesForDownload = options.fileMaxBytesForDownload ?? DEFAULT_FILE_MAX_BYTES;
    this.extraRunArgs = options.extraRunArgs ?? [];
    this.scope = options.scope ?? DEFAULT_SCOPE;
    this.logger = options.logger;
  }

  /** Probe whether a usable container runtime is present. */
  static async isSupported(dockerBinary = 'docker'): Promise<DockerSandboxSupportResult> {
    try {
      const result = await runProcess({
        file: dockerBinary,
        args: ['version', '--format', '{{.Server.Version}}'],
        timeoutMs: PROBE_TIMEOUT_MS,
      });
      if (result.exitCode !== 0) {
        return {
          supported: false,
          reason: `\`${dockerBinary} version\` exited ${String(result.exitCode)}: ${result.stderr.trim() || 'no stderr'}`,
        };
      }
      return { supported: true, version: result.stdout.toString('utf8').trim() };
    } catch (error) {
      return { supported: false, reason: `${dockerBinary} not usable: ${errorMessage(error)}` };
    }
  }

  /**
   * Ensures the image is present, pulling in the background if not.
   *
   * Must return promptly: callers wrap this in a short `withTimeout` (3s in the
   * settings route), and a cold CUDA image is several gigabytes. So the pull is
   * started detached and the call reports `pending`, which is exactly the
   * contract the interface documents.
   */
  async buildImage(): Promise<SandboxBuild> {
    if (await this.imagePresent()) {
      return DockerSandboxProvider.readyBuild;
    }
    const state = pullState.get(this.image) ?? { inFlight: undefined, failure: undefined };
    if (state.inFlight === undefined) {
      state.failure = undefined;
      state.inFlight = runProcess({
        file: this.dockerBinary,
        args: ['pull', this.image],
        timeoutMs: 60 * 60_000,
      })
        .then(pull => {
          if (pull.exitCode !== 0) {
            state.failure = pull.stderr.trim() || `exit ${String(pull.exitCode)}`;
          }
        })
        .catch((error: unknown) => {
          state.failure = errorMessage(error);
        })
        .finally(() => {
          state.inFlight = undefined;
        });
      pullState.set(this.image, state);
      this.logger.info('DockerSandboxProvider started image pull', { image: this.image });
    }
    return { status: 'pending', reason: `pulling ${this.image}`, metadata: { image: this.image } };
  }

  async getImageBuildStatus(): Promise<SandboxBuild> {
    if (await this.imagePresent()) {
      return DockerSandboxProvider.readyBuild;
    }
    const state = pullState.get(this.image);
    if (state?.inFlight !== undefined) {
      return { status: 'pending', reason: `pulling ${this.image}`, metadata: { image: this.image } };
    }
    if (state?.failure !== undefined) {
      return {
        status: 'failed',
        reason: `failed to pull ${this.image}: ${state.failure}`,
        metadata: { image: this.image },
      };
    }
    return { status: 'pending', reason: `image ${this.image} not present locally`, metadata: { image: this.image } };
  }

  private async imagePresent(): Promise<boolean> {
    const result = await runProcess({
      file: this.dockerBinary,
      args: ['image', 'inspect', this.image],
      timeoutMs: PROBE_TIMEOUT_MS,
    }).catch(() => undefined);
    return result?.exitCode === 0;
  }

  async createSandbox(): Promise<{ sandboxId: string }> {
    const id = ulid().toLowerCase();
    const containerName = `${CONTAINER_NAME_PREFIX}${id}`;
    const sandboxId = posix.join(SANDBOX_PARENT, id);

    const args = [
      'run',
      '--detach',
      '--name',
      containerName,
      // Keep the container alive without a workload; every command arrives via
      // `docker exec`. `sleep infinity` as PID 1 reaps nothing, so init is on.
      '--init',
      '--workdir',
      sandboxId,
      // Ownership marker so stale sandboxes can be found and reaped without
      // relying on any process having kept a handle to them.
      '--label',
      `${OWNER_LABEL}=1`,
      '--label',
      `${SCOPE_LABEL}=${this.scope}`,
      ...(this.gpus === undefined ? [] : ['--gpus', this.gpus]),
      ...this.extraRunArgs,
      this.image,
      'sleep',
      'infinity',
    ];

    const created = await runProcess({ file: this.dockerBinary, args, timeoutMs: 5 * 60_000 });
    if (created.exitCode !== 0) {
      throw new SandboxNotAvailableError(`failed to start sandbox container: ${created.stderr.trim() || 'no stderr'}`);
    }

    this.ownCreations.add(sandboxId);

    // `--workdir` creates the directory, but the layout subdirectories and the
    // venv do not exist yet. Failure here must not leak the container.
    try {
      await this.execInContainer({
        containerName,
        command: [
          `mkdir -p ${shellEscape(this.getToolResultDumpDir())}`,
          shellEscape(this.getFileUploadsDir()),
          shellEscape(this.getSkillsDir()),
        ].join(' '),
        cwd: sandboxId,
        timeoutSeconds: this.execTimeoutSeconds,
      });
    } catch (error) {
      await this.removeContainer(sandboxId).catch(() => undefined);
      throw error;
    }

    this.logger.info('DockerSandboxProvider created sandbox', {
      sandboxId,
      containerName,
      image: this.image,
      gpus: this.gpus ?? null,
    });
    return { sandboxId };
  }

  async exec(params: SandboxExecParams): Promise<ExecResult> {
    const containerName = this.requireContainer(params.sandboxId);
    try {
      const cwd =
        params.cwd === undefined || params.cwd === ''
          ? params.sandboxId
          : this.resolveInSandboxRoot(params.sandboxId, params.cwd);
      const env =
        params.env === undefined ? undefined : absolutizeRelativeExecEnv({ root: params.sandboxId, env: params.env });

      const result = await this.execInContainer({
        containerName,
        command: params.command,
        cwd,
        ...(env === undefined ? {} : { env }),
        timeoutSeconds: params.timeoutSeconds ?? this.execTimeoutSeconds,
      });

      return {
        success: true,
        response: {
          exitCode: result.exitCode,
          result: result.stdout.toString('utf8') + result.stderr,
        },
      };
    } catch (error) {
      if (error instanceof SandboxNotAvailableError) {
        throw error;
      }
      return { success: false, error: errorMessage(error) };
    }
  }

  getAdditionalInstructions(): string {
    return [
      'SANDBOX RULES:',
      `- Commands run inside a container from image ${this.image}.`,
      ...(this.gpus === undefined ? [] : ['- An NVIDIA GPU is attached. `nvidia-smi` and CUDA are available.']),
      '- uploads, skills, and tool-results live in the sandbox working directory.',
      '- ALL file creation and writes MUST stay within the sandbox working directory.',
      '- The container is discarded when the sandbox ends; nothing outside the working directory persists.',
    ].join('\n');
  }

  // Cwd-relative, matching the local provider: exec cwd is the sandbox root, so
  // the layout paths stay free of absolute prefixes.
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
    const containerName = this.requireContainer(params.sandboxId);
    const absolutePath = this.resolveInSandboxRoot(params.sandboxId, params.path);

    // Classification and read happen in one invocation. Two `docker exec` calls
    // would leave a window in which the path could be swapped for a symlink
    // between the check and the read. Distinct exit codes carry the error kind
    // back, so stdout stays pure file bytes.
    const read = await this.execInContainer({
      containerName,
      command: containedCommand({
        root: params.sandboxId,
        path: absolutePath,
        timeoutSeconds: this.execTimeoutSeconds,
        command: [
          'if [ -d "$__tfy_target" ]; then exit 78; fi',
          'if [ ! -f "$__tfy_target" ]; then exit 79; fi',
          `if [ "$(wc -c < "$__tfy_target")" -gt ${String(this.fileMaxBytesForDownload)} ]; then exit 80; fi`,
          'cat "$__tfy_target"',
        ].join('; '),
      }),
      cwd: params.sandboxId,
      timeoutSeconds: this.execTimeoutSeconds,
      maxStdoutBytes: this.fileMaxBytesForDownload,
      raw: true,
    });

    // The in-shell `wc -c` check and the `cat` are one invocation, but a sandbox
    // process can still grow the file mid-stream, so the streaming cap is the
    // final enforcement layer and has to report itself as such.
    if (read.outputCapExceeded) {
      throw new SandboxFileTooLargeError(params.path, this.fileMaxBytesForDownload + 1, this.fileMaxBytesForDownload);
    }

    switch (read.exitCode) {
      case 0:
        return read.stdout;
      case 78:
        throw new SandboxPathIsDirectoryError(params.path);
      case 80:
        throw new SandboxFileTooLargeError(params.path, this.fileMaxBytesForDownload + 1, this.fileMaxBytesForDownload);
      case CONTAINMENT_VIOLATION_EXIT:
      case 79:
      default:
        throw new SandboxFileNotFoundError(params.path);
    }
  }

  async uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void> {
    const containerName = this.requireContainer(params.sandboxId);
    const absolutePath = this.resolveInSandboxRoot(params.sandboxId, params.remotePath);

    // Payload travels on stdin. Encoding it into the command string would cap
    // uploads at roughly 96 KiB (MAX_ARG_STRLEN); see upstream issue #416.
    const result = await this.execInContainer({
      containerName,
      command: containedCommand({
        root: params.sandboxId,
        path: absolutePath,
        timeoutSeconds: this.execTimeoutSeconds,
        command: 'mkdir -p "$(dirname "$__tfy_target")" && cat > "$__tfy_target"',
      }),
      cwd: params.sandboxId,
      timeoutSeconds: this.execTimeoutSeconds,
      stdin: params.content,
      raw: true,
    });
    if (result.exitCode === CONTAINMENT_VIOLATION_EXIT) {
      throw new SandboxFileNotFoundError(params.remotePath);
    }
    if (result.exitCode !== 0) {
      throw new Error(`upload to ${params.remotePath} failed: ${result.stderr.trim() || 'no stderr'}`);
    }
  }

  /**
   * Code Mode needs a bidirectional transport between the harness and the
   * sandbox. The local provider uses a unix socket on a shared filesystem, which
   * a container does not have by construction. Wiring this up needs a deliberate
   * transport choice, so it throws rather than half-working.
   */
  createCodeModeTransport(): CodeModeTransport {
    throw new CodeModeUnsupportedError(this.type);
  }

  /** Removes containers this instance started. Safe to call twice. */
  async dispose(): Promise<void> {
    const ids = [...this.ownCreations];
    await Promise.all(ids.map(async id => this.removeContainer(id).catch(() => undefined)));
  }

  /**
   * Removes sandbox containers created more than `olderThanMs` ago.
   *
   * `dispose()` alone is not enough: the server builds a fresh provider per turn
   * and never disposes it, so nothing would ever clean up. Ownership is recovered
   * from the container label rather than in-process bookkeeping, which also
   * reclaims sandboxes orphaned by a server restart or crash.
   */
  static async reapStale(params: {
    /** Only containers created with this scope are eligible. */
    scope: string;
    olderThanMs: number;
    logger: Logger;
    dockerBinary?: string;
  }): Promise<{ removed: string[] }> {
    if (!Number.isFinite(params.olderThanMs) || params.olderThanMs < 0) {
      // A negative cutoff would make every container in scope stale, including
      // ones a live session is using. Callers that want that must say so by
      // passing 0, which is at least explicit about meaning "everything".
      throw new RangeError(`olderThanMs must be a non-negative number, got ${String(params.olderThanMs)}`);
    }
    const docker = params.dockerBinary ?? 'docker';
    const listed = await runProcess({
      file: docker,
      args: [
        'ps',
        '--all',
        '--filter',
        `label=${OWNER_LABEL}`,
        '--filter',
        `label=${SCOPE_LABEL}=${params.scope}`,
        '--format',
        '{{.Names}}',
      ],
      timeoutMs: PROBE_TIMEOUT_MS,
    }).catch(() => undefined);
    if (listed?.exitCode !== 0) {
      return { removed: [] };
    }
    const names = listed.stdout
      .toString('utf8')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.length > 0);
    if (names.length === 0) {
      return { removed: [] };
    }

    // `docker ps --format {{.CreatedAt}}` emits e.g. "2026-08-25 23:59:01 +0530 IST",
    // which Date.parse rejects as NaN. `inspect .Created` is RFC 3339 instead.
    const inspected = await runProcess({
      file: docker,
      args: ['inspect', '--format', '{{.Name}}\t{{.Created}}', ...names],
      timeoutMs: PROBE_TIMEOUT_MS,
    }).catch(() => undefined);
    if (inspected?.exitCode !== 0) {
      return { removed: [] };
    }

    const cutoff = Date.now() - params.olderThanMs;
    const stale: string[] = [];
    for (const line of inspected.stdout.toString('utf8').split('\n')) {
      const [rawName, createdAt] = line.split('\t');
      if (rawName === undefined || createdAt === undefined) {
        continue;
      }
      // `.Name` comes back with a leading slash.
      const name = rawName.trim().replace(/^\//, '');
      if (name.length === 0) {
        continue;
      }
      const created = Date.parse(createdAt.trim());
      // An unparseable timestamp must not be read as "ancient" — skip it rather
      // than delete a container that might be in use.
      if (Number.isNaN(created) || created >= cutoff) {
        continue;
      }
      stale.push(name);
    }

    await Promise.all(
      stale.map(async name =>
        runProcess({
          file: docker,
          args: ['rm', '--force', '--volumes', name],
          timeoutMs: 60_000,
        }).catch(() => undefined),
      ),
    );
    if (stale.length > 0) {
      params.logger.info('DockerSandboxProvider reaped stale sandboxes', {
        count: stale.length,
        scope: params.scope,
      });
    }
    return { removed: stale };
  }

  private async removeContainer(sandboxId: string): Promise<void> {
    this.ownCreations.delete(sandboxId);
    await runProcess({
      file: this.dockerBinary,
      args: ['rm', '--force', '--volumes', containerNameFor(sandboxId)],
      timeoutMs: 60_000,
    });
  }

  /**
   * Container name for a sandbox id, derived rather than looked up.
   *
   * The server constructs a new provider for every turn and then hands it a
   * sandbox id carried over from a previous turn, so any in-instance map would be
   * empty exactly when it was needed. Deriving the name makes a sandbox
   * addressable by any provider instance pointed at the same daemon.
   */
  private requireContainer(sandboxId: string): string {
    return containerNameFor(sandboxId);
  }

  /**
   * Confine a caller-supplied path to the sandbox root. Uses the platform
   * resolver for `..` collapsing, then re-checks containment, because a path
   * that escapes must be reported as not-found rather than silently clamped.
   */
  private resolveInSandboxRoot(sandboxRootPath: string, userPath: string): string {
    validateNoPathTraversal(userPath);
    const resolved = userPath.startsWith('/') ? resolve(userPath) : resolve(sandboxRootPath, userPath);
    const root = resolve(sandboxRootPath);
    if (resolved !== root && !resolved.startsWith(root + sep)) {
      throw new SandboxFileNotFoundError(userPath);
    }
    return resolved;
  }

  private async execInContainer(params: {
    containerName: string;
    command: string;
    cwd: string;
    env?: Record<string, string>;
    timeoutSeconds: number;
    stdin?: Buffer;
    maxStdoutBytes?: number;
    /** Command already carries its own in-container `timeout`; do not add one. */
    raw?: boolean;
  }): Promise<RunResult> {
    const args = ['exec', '--workdir', params.cwd];
    if (params.stdin !== undefined) {
      args.push('--interactive');
    }
    for (const [key, value] of Object.entries(params.env ?? {})) {
      args.push('--env', `${key}=${value}`);
    }
    // Killing the local `docker exec` client does not kill the process inside the
    // container (runc#3359), so the bound has to be applied in there too. The
    // outer kill below remains as a backstop for a wedged daemon connection.
    // `--verbose` makes the timeout self-describing on stderr ("timeout: sending
    // signal TERM to command ..."). Needed because GNU timeout exits 124 when it
    // fires *and* passes a command's own 124 straight through, so the status alone
    // cannot distinguish them.
    const command =
      params.raw === true
        ? params.command
        : `timeout --verbose ${String(params.timeoutSeconds)}s sh -c ${shellEscape(params.command)}`;
    args.push(params.containerName, 'sh', '-c', command);

    const result = await runProcess({
      file: this.dockerBinary,
      args,
      // Grace margin so the in-container `timeout` fires first and the workload is
      // actually killed. If the outer bound won the race we would kill the client
      // and leave the command running.
      timeoutMs: params.timeoutSeconds * 1000 + OUTER_TIMEOUT_GRACE_MS,
      ...(params.stdin === undefined ? {} : { stdin: params.stdin }),
      ...(params.maxStdoutBytes === undefined ? {} : { maxStdoutBytes: params.maxStdoutBytes }),
    });
    if (result.timedOut) {
      throw new Error(
        `command exceeded ${String(params.timeoutSeconds)}s and the container-side timeout did not fire; ` +
          'the docker daemon connection may be wedged',
      );
    }
    // Exit 124 is deliberately *not* turned into a failure. The contract puts
    // command exit codes inside a successful execution response and reserves
    // success:false for infrastructure faults, and a command may legitimately exit
    // 124 itself. The `--verbose` diagnostic on stderr is what tells a reader a
    // timeout fired.
    return result;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Derives the container name from a sandbox id. Validates the shape rather than
 * trusting it: the id reaches us from persisted session state, and it is about to
 * become a `docker` argument.
 */
function containerNameFor(sandboxId: string): string {
  const parent = posix.dirname(sandboxId);
  const slug = posix.basename(sandboxId);
  if (parent !== SANDBOX_PARENT || !SANDBOX_SLUG_RE.test(slug)) {
    throw new SandboxNotAvailableError(`not a docker sandbox id: ${sandboxId}`);
  }
  return `${CONTAINER_NAME_PREFIX}${slug}`;
}

/**
 * Wraps a command so it is confined to `root` and, on timeout, actually dies.
 *
 * Two problems are solved in one shell invocation:
 *
 * 1. Symlink escape. Lexical containment on the host cannot see that
 *    `<root>/link` is a symlink to `/etc/shadow`; `realpath` resolves it and the
 *    prefix is rechecked against the resolved target. Doing the check and the
 *    operation in one invocation also removes the check/use window that two
 *    separate `docker exec` calls would leave open.
 * 2. Runaway workloads. Killing the local `docker exec` client does not kill the
 *    process inside the container (runc#3359), so the timeout is applied by
 *    `timeout` *inside* the container as well.
 */
function containedCommand(params: { root: string; path: string; command: string; timeoutSeconds: number }): string {
  return [
    `__tfy_root=${shellEscape(params.root)}`,
    // `-m` allows a not-yet-existing final component (uploads) while still
    // resolving symlinks in every component that does exist.
    `__tfy_target=$(realpath -m -- ${shellEscape(params.path)})`,
    // Quoted variable in the pattern compares literally, not as a glob.
    `case "$__tfy_target" in "$__tfy_root"/*) ;; *) echo "path escapes sandbox root" >&2; exit 77 ;; esac`,
    // Refuse a symlink even when it resolves inside the root: following one is
    // never required here, and allowing it re-opens the swap-after-check window.
    `if [ -L "$__tfy_target" ]; then echo "path is a symlink" >&2; exit 77; fi`,
    'export __tfy_target',
    `timeout --verbose ${String(params.timeoutSeconds)}s sh -c ${shellEscape(params.command)}`,
  ].join('; ');
}

/** Exit status used by {@link containedCommand} when a path leaves the sandbox. */
const CONTAINMENT_VIOLATION_EXIT = 77;

/**
 * Spawn a process, collecting stdout as bytes. stdout stays a Buffer because
 * downloads carry arbitrary binary content; stderr is decoded because it is only
 * ever shown to a human or a model.
 */
async function runProcess(params: {
  file: string;
  args: readonly string[];
  timeoutMs: number;
  stdin?: Buffer;
  maxStdoutBytes?: number;
}): Promise<RunResult> {
  return new Promise<RunResult>((resolvePromise, rejectPromise) => {
    const child = spawn(params.file, [...params.args], { stdio: ['pipe', 'pipe', 'pipe'] });

    const stdoutChunks: Buffer[] = [];
    let stdoutBytes = 0;
    let stderr = '';
    let timedOut = false;
    let outputCapExceeded = false;
    let settled = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, params.timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (params.maxStdoutBytes !== undefined && stdoutBytes > params.maxStdoutBytes) {
        outputCapExceeded = true;
        child.kill('SIGKILL');
        return;
      }
      stdoutChunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    const settle = (fn: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      fn();
    };

    child.on('error', error => {
      settle(() => {
        rejectPromise(error);
      });
    });

    child.on('close', code => {
      settle(() => {
        resolvePromise({
          exitCode: code ?? -1,
          stdout: Buffer.concat(stdoutChunks),
          stderr,
          timedOut,
          outputCapExceeded,
        });
      });
    });

    if (params.stdin !== undefined) {
      child.stdin.end(params.stdin);
    } else {
      child.stdin.end();
    }
  });
}
