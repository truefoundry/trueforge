/**
 * SandboxProvider backed by a Kubernetes pod (or, via a different backend implementation, the
 * `sandbox.x-k8s.io` CR). Read alongside TFYSandboxProvider — the layout/exec/file contract is
 * the same cwd-relative, no-FS-jail shape; only the transport differs.
 */
import {
  CodeModeNatsTransport,
  DEFAULT_SANDBOX_NATS_WS_PORT,
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxPathIsDirectoryError,
  absolutizeRelativeExecEnv,
  shellEscape,
  validateSandboxOwnedByTenant,
  withMcpClientOnPath,
  type CodeModeTransport,
  type ExecResult,
  type SandboxBuild,
  type SandboxExecParams,
  type SandboxProvider,
} from '@truefoundry/trueforge-core/core';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path/posix';
import type { Logger } from 'winston';
import type { SandboxBackend, SandboxPod } from '../backend/SandboxBackend';
import { PodExecTransportError, runPodExec, type PodExecClient } from '../core/kubeExec';
import { buildPodExecArgv } from '../core/podExecCommand';
import { KubernetesSandboxReaper } from '../core/reaper';

const DEFAULT_EXEC_TIMEOUT_SECONDS = 60;
const DEFAULT_CREATE_TIMEOUT_MS = 120_000;
// pods/exec has no server-side timeout field (unlike TFY); the client-side timeout is the only cap.
const FILE_UPLOAD_TIMEOUT_MS = 30 * 60 * 1000;

const POD_NAME_PREFIX = 'sbx-';

function parsePwdAndPath(text: string): { root: string; inheritedPath: string } | undefined {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const root = lines[0];
  if (!root?.startsWith('/')) {
    return undefined;
  }
  return { root, inheritedPath: lines[1] ?? '' };
}

interface StatResult {
  size: number;
  type: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStatResult(value: unknown): StatResult {
  if (!isRecord(value) || typeof value['size'] !== 'number' || typeof value['type'] !== 'string') {
    throw new Error('Sandbox stat returned an invalid response');
  }
  return { size: value['size'], type: value['type'] };
}

type RawExecResult =
  { success: true; exitCode: number; stdout: Buffer; stderr: string } | { success: false; error: string };

/** Resolves a sandbox's running pod to the NATS WebSocket URL that reaches its bridge. */
export type NatsHostUrlResolver = (pod: SandboxPod) => Promise<string>;

export interface KubernetesSandboxProviderOptions {
  backend: SandboxBackend;
  execClient: PodExecClient;
  resolveNatsHostUrl: NatsHostUrlResolver;
  tenantName: string;
  fileMaxBytesForDownload: number;
  defaultExecTimeoutMs?: number | undefined;
  createTimeoutMs?: number | undefined;
  reaperTtlMs?: number | undefined;
  logger: Logger;
}

export class KubernetesSandboxProvider implements SandboxProvider {
  readonly type = 'kubernetes';
  private readonly backend: SandboxBackend;
  private readonly execClient: PodExecClient;
  private readonly resolveNatsHostUrl: NatsHostUrlResolver;
  private readonly tenantName: string;
  private readonly fileMaxBytesForDownload: number;
  private readonly defaultExecTimeoutSeconds: number;
  private readonly createTimeoutMs: number;
  private readonly logger: Logger;
  private readonly reaper: KubernetesSandboxReaper;
  /** Discovered via `pwd` + `$PATH` on first exec — never a hardcoded host layout. */
  private readonly sandboxLayouts = new Map<string, { root: string; inheritedPath: string }>();

  constructor(options: KubernetesSandboxProviderOptions) {
    this.backend = options.backend;
    this.execClient = options.execClient;
    this.resolveNatsHostUrl = options.resolveNatsHostUrl;
    this.tenantName = options.tenantName;
    this.fileMaxBytesForDownload = options.fileMaxBytesForDownload;
    this.defaultExecTimeoutSeconds = Math.ceil(
      (options.defaultExecTimeoutMs ?? DEFAULT_EXEC_TIMEOUT_SECONDS * 1000) / 1000,
    );
    this.createTimeoutMs = options.createTimeoutMs ?? DEFAULT_CREATE_TIMEOUT_MS;
    this.logger = options.logger.child({ module: 'KubernetesSandboxProvider' });
    this.reaper = new KubernetesSandboxReaper({
      backend: this.backend,
      tenantId: this.tenantName,
      ttlMs: options.reaperTtlMs ?? 24 * 60 * 60 * 1000,
      logger: this.logger,
    });
  }

  // Kubernetes pulls a prebuilt image from a registry — no per-tenant build step.
  private readyBuild(): SandboxBuild {
    return { status: 'ready', reason: null, metadata: { backend: this.backend.kind } };
  }

  buildImage(): Promise<SandboxBuild> {
    return Promise.resolve(this.readyBuild());
  }

  getImageBuildStatus(): Promise<SandboxBuild> {
    return Promise.resolve(this.readyBuild());
  }

  /** `<tenant>.<uuid>` keeps `validateSandboxOwnedByTenant` unchanged; the pod name is `sbx-<uuid>` (dots/uppercase are not valid in a pod name). */
  private podNameForSandboxId(sandboxId: string): string {
    validateSandboxOwnedByTenant({ sandboxId, tenantName: this.tenantName });
    return `${POD_NAME_PREFIX}${sandboxId.slice(this.tenantName.length + 1)}`;
  }

  async createSandbox(): Promise<{ sandboxId: string }> {
    await this.reaper.reap().catch((error: unknown) => {
      this.logger.warn('Kubernetes sandbox reaper failed', { error });
    });
    const id = randomUUID();
    const name = `${POD_NAME_PREFIX}${id}`;
    const sandboxId = `${this.tenantName}.${id}`;
    await this.backend.create({ name, tenantId: this.tenantName });
    await this.backend.waitUntilRunning({ name, timeoutMs: this.createTimeoutMs });
    this.logger.debug(`Sandbox created: id=${sandboxId}`);
    return { sandboxId };
  }

  /** Throws `SandboxNotAvailableError` (via the backend) for a deleted or evicted pod. */
  private async resolveRunningPod(sandboxId: string): Promise<SandboxPod> {
    return this.backend.getRunningPod({ name: this.podNameForSandboxId(sandboxId) });
  }

  private async rawExec(params: {
    pod: SandboxPod;
    command: string;
    cwd?: string | undefined;
    env?: Record<string, string> | undefined;
    stdin?: Buffer | undefined;
    timeoutSeconds?: number | undefined;
  }): Promise<RawExecResult> {
    const argv = buildPodExecArgv({ command: params.command, cwd: params.cwd, env: params.env });
    const timeoutSeconds = params.timeoutSeconds ?? this.defaultExecTimeoutSeconds;
    try {
      const result = await runPodExec({
        client: this.execClient,
        target: params.pod.target,
        command: argv,
        stdin: params.stdin,
        timeoutMs: timeoutSeconds * 1000,
      });
      return { success: true, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr };
    } catch (e) {
      if (e instanceof PodExecTransportError) {
        this.logger.error('Sandbox exec failed', { error: e.message });
        return { success: false, error: e.message };
      }
      throw e;
    }
  }

  private async sandboxLayout(params: {
    sandboxId: string;
    pod: SandboxPod;
  }): Promise<{ root: string; inheritedPath: string }> {
    const cached = this.sandboxLayouts.get(params.sandboxId);
    if (cached !== undefined) {
      return cached;
    }
    const result = await this.rawExec({ pod: params.pod, command: 'printf \'%s\\n%s\\n\' "$(pwd)" "$PATH"' });
    if (!result.success) {
      throw new Error(`Failed to resolve sandbox working directory: ${result.error}`);
    }
    const text = result.stdout.toString('utf8');
    const parsed = parsePwdAndPath(text);
    if (parsed === undefined) {
      throw new Error(`sandbox pwd did not return an absolute path: ${text}`);
    }
    this.sandboxLayouts.set(params.sandboxId, parsed);
    return parsed;
  }

  /**
   * No extra FS jail: exec cwd is the container's WORKDIR. Layout getters are cwd-relative so
   * writes cannot escape it. PATH / PYTHONPATH / GIT_CONFIG must still be absolute so git and
   * `mcp-client` work after `cd` — resolved from `pwd` / `$PATH`, not a hardcoded prefix.
   */
  async exec(params: SandboxExecParams): Promise<ExecResult> {
    validateSandboxOwnedByTenant({ sandboxId: params.sandboxId, tenantName: this.tenantName });
    const pod = await this.resolveRunningPod(params.sandboxId);
    const { root, inheritedPath } = await this.sandboxLayout({ sandboxId: params.sandboxId, pod });
    const incoming = params.env ?? {};
    const env = absolutizeRelativeExecEnv({
      root,
      env: { ...incoming, PATH: withMcpClientOnPath(incoming['PATH'] ?? inheritedPath) },
    });
    const result = await this.rawExec({
      pod,
      command: params.command,
      cwd: params.cwd,
      env,
      timeoutSeconds: params.timeoutSeconds,
    });
    if (!result.success) {
      return result;
    }
    return {
      success: true,
      response: { exitCode: result.exitCode, result: result.stdout.toString('utf8') + result.stderr },
    };
  }

  private async getFileInfo(params: { pod: SandboxPod; path: string }): Promise<{ size: number; isDir: boolean }> {
    const result = await this.rawExec({
      pod: params.pod,
      command: `stat -L --printf='{"size":%s,"type":"%F"}' ${shellEscape(params.path)}`,
    });
    if (!result.success) {
      throw new Error(`Failed to stat file: ${result.error}`);
    }
    if (result.exitCode !== 0) {
      throw new SandboxFileNotFoundError(params.path);
    }
    const parsed = parseStatResult(JSON.parse(result.stdout.toString('utf8')));
    return { size: parsed.size, isDir: parsed.type === 'directory' };
  }

  /**
   * `pods/exec` is a raw binary stream (unlike TFY's JSON-over-HTTP protocol), so unlike TFY this
   * skips base64 entirely — `kubeExec` already carries stdout as an untouched Buffer.
   */
  async downloadFile(params: { sandboxId: string; path: string }): Promise<Buffer> {
    validateSandboxOwnedByTenant({ sandboxId: params.sandboxId, tenantName: this.tenantName });
    const pod = await this.resolveRunningPod(params.sandboxId);
    const info = await this.getFileInfo({ pod, path: params.path });
    if (info.isDir) {
      throw new SandboxPathIsDirectoryError(params.path);
    }
    if (info.size > this.fileMaxBytesForDownload) {
      throw new SandboxFileTooLargeError(params.path, info.size, this.fileMaxBytesForDownload);
    }
    const result = await this.rawExec({ pod, command: `cat ${shellEscape(params.path)}` });
    if (!result.success) {
      throw new Error(`Failed to download file: ${result.error}`);
    }
    if (result.exitCode !== 0) {
      throw new SandboxFileNotFoundError(params.path);
    }
    return result.stdout;
  }

  /** Streams the content over stdin — binary-safe, no base64. */
  async uploadFile(params: { sandboxId: string; remotePath: string; content: Buffer }): Promise<void> {
    validateSandboxOwnedByTenant({ sandboxId: params.sandboxId, tenantName: this.tenantName });
    const pod = await this.resolveRunningPod(params.sandboxId);
    this.logger.info('Uploading file to sandbox', {
      sandboxId: params.sandboxId,
      remotePath: params.remotePath,
      bytes: params.content.byteLength,
    });
    const result = await this.rawExec({
      pod,
      command: `cat > ${shellEscape(params.remotePath)}`,
      stdin: params.content,
      timeoutSeconds: Math.ceil(FILE_UPLOAD_TIMEOUT_MS / 1000),
    });
    if (!result.success) {
      throw new Error(`File upload to sandbox failed: ${result.error}`);
    }
    if (result.exitCode !== 0) {
      throw new Error(`File upload to sandbox failed (exit code ${String(result.exitCode)}): ${result.stderr}`);
    }
  }

  // The pod's NATS WebSocket bridge is reachable at a URL only known once the pod is running.
  createCodeModeTransport(): CodeModeTransport {
    return new CodeModeNatsTransport({
      resolveHostUrl: async (sandboxId: string) => {
        const pod = await this.resolveRunningPod(sandboxId);
        return this.resolveNatsHostUrl(pod);
      },
      sandboxClientNatsUrl: `ws://localhost:${String(DEFAULT_SANDBOX_NATS_WS_PORT)}`,
      logger: this.logger,
      mcpClientInstall: { remotePath: join('mcp-client', 'mcp_client.py') },
    });
  }

  getAdditionalInstructions(): string {
    return [
      'SANDBOX RULES:',
      "- The Agent's first sandbox command should be `pwd` to discover the working directory.",
      '- uploads, skills, and tool-results live in that working directory (not /tmp or /opt).',
      '- ALL file creation and writes MUST stay within that working directory.',
      '- The Agent must NOT write to /tmp/, ~/, or any absolute path outside the working directory.',
    ].join('\n');
  }

  // Cwd-relative (no FS jail). exec() pwd-joins GIT_CONFIG / PATH / PYTHONPATH.
  //   uploads, skills, tool-results, skill_downloader.py, .git-credentials
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

  getSkillDownloaderPath(): string {
    return 'skill_downloader.py';
  }
}
