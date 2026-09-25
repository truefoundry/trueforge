import {
  SandboxFileNotFoundError,
  SandboxFileTooLargeError,
  SandboxPathIsDirectoryError,
} from '@truefoundry/trueforge-core/core';
import { createLogger } from 'winston';
import type {
  SandboxBackend,
  SandboxListEntry,
  SandboxPod,
} from '../../../../../src/sandbox/kubernetes/backend/SandboxBackend';
import type { PodExecClient, PodExecTarget } from '../../../../../src/sandbox/kubernetes/core/kubeExec';
import { KubernetesSandboxProvider } from '../../../../../src/sandbox/kubernetes/provider/KubernetesSandboxProvider';

const TENANT = 'acme';

interface ExecCall {
  target: PodExecTarget;
  argv: readonly string[];
  stdin: Buffer | null;
}

/** Scripts the exec client to answer in order; each call's response defaults to the last one given. */
function fakeExecClient(responses: { stdout?: string | Buffer; stderr?: string; exitCode?: number }[]): {
  client: PodExecClient;
  calls: ExecCall[];
} {
  const calls: ExecCall[] = [];
  const client: PodExecClient = {
    exec: params => {
      const call: ExecCall = {
        target: { namespace: params.namespace, podName: params.podName, containerName: params.containerName },
        argv: params.command,
        stdin: null,
      };
      calls.push(call);
      const script = responses[Math.min(calls.length - 1, responses.length - 1)] ?? {};
      const respond = (): void => {
        if (script.stdout !== undefined) {
          params.stdout.write(Buffer.isBuffer(script.stdout) ? script.stdout : Buffer.from(script.stdout, 'utf8'));
        }
        if (script.stderr !== undefined) {
          params.stderr.write(Buffer.from(script.stderr, 'utf8'));
        }
        const code = script.exitCode ?? 0;
        params.onStatus(
          code === 0
            ? { status: 'Success' }
            : {
                status: 'Failure',
                reason: 'NonZeroExitCode',
                details: { causes: [{ reason: 'ExitCode', message: String(code) }] },
              },
        );
        params.onClose();
      };
      // Drain stdin fully before responding — a real exec channel processes input before closing.
      if (params.stdin !== null) {
        const chunks: Buffer[] = [];
        params.stdin.on('data', (chunk: Buffer) => chunks.push(chunk));
        params.stdin.on('end', () => {
          call.stdin = Buffer.concat(chunks);
          respond();
        });
      } else {
        setImmediate(respond);
      }
      return Promise.resolve({ close: () => undefined });
    },
  };
  return { client, calls };
}

function fakePod(overrides: Partial<SandboxPod> = {}): SandboxPod {
  return {
    target: { namespace: 'trueforge-sandboxes', podName: 'sbx-fake', containerName: 'sandbox' },
    podIp: '10.1.2.3',
    ...overrides,
  };
}

interface FakeBackendScript {
  create?: () => Promise<void> | void;
  waitUntilRunning?: (params: { name: string; timeoutMs: number }) => Promise<SandboxPod>;
  getRunningPod?: (params: { name: string }) => Promise<SandboxPod>;
}

function fakeBackend(script: FakeBackendScript = {}): { backend: SandboxBackend; calls: Record<string, unknown[]> } {
  const calls: Record<string, unknown[]> = {
    create: [],
    waitUntilRunning: [],
    getRunningPod: [],
    delete: [],
    list: [],
  };
  const backend: SandboxBackend = {
    kind: 'pod',
    create: async params => {
      calls['create']?.push(params);
      await script.create?.();
    },
    waitUntilRunning: async params => {
      calls['waitUntilRunning']?.push(params);
      return (
        (await script.waitUntilRunning?.(params)) ??
        fakePod({ target: { namespace: 'ns', podName: params.name, containerName: 'sandbox' } })
      );
    },
    getRunningPod: async params => {
      calls['getRunningPod']?.push(params);
      return (
        (await script.getRunningPod?.(params)) ??
        fakePod({ target: { namespace: 'ns', podName: params.name, containerName: 'sandbox' } })
      );
    },
    delete: async params => {
      calls['delete']?.push(params);
    },
    list: (): Promise<readonly SandboxListEntry[]> => {
      calls['list']?.push({});
      return Promise.resolve([]);
    },
  };
  return { backend, calls };
}

function provider(params: {
  backend: SandboxBackend;
  execClient: PodExecClient;
  resolveNatsHostUrl?: (pod: SandboxPod) => Promise<string>;
}): KubernetesSandboxProvider {
  return new KubernetesSandboxProvider({
    backend: params.backend,
    execClient: params.execClient,
    resolveNatsHostUrl: params.resolveNatsHostUrl ?? (async pod => `ws://${pod.podIp}:4444`),
    tenantName: TENANT,
    fileMaxBytesForDownload: 1_000_000,
    logger: createLogger({ silent: true }),
  });
}

describe('KubernetesSandboxProvider', () => {
  it('reports its provider type', () => {
    const { backend } = fakeBackend();
    const { client } = fakeExecClient([]);
    expect(provider({ backend, execClient: client }).type).toBe('kubernetes');
  });

  it('reports a static ready build — Kubernetes pulls, it does not build', async () => {
    const { backend } = fakeBackend();
    const { client } = fakeExecClient([]);
    const p = provider({ backend, execClient: client });
    await expect(p.buildImage()).resolves.toEqual({ status: 'ready', reason: null, metadata: { backend: 'pod' } });
    await expect(p.getImageBuildStatus()).resolves.toEqual({
      status: 'ready',
      reason: null,
      metadata: { backend: 'pod' },
    });
  });

  describe('createSandbox', () => {
    it('creates a tenant-scoped pod and waits for it to be running', async () => {
      const { backend, calls } = fakeBackend();
      const { client } = fakeExecClient([]);
      const { sandboxId } = await provider({ backend, execClient: client }).createSandbox();

      expect(sandboxId.startsWith(`${TENANT}.`)).toBe(true);
      const uuid = sandboxId.slice(TENANT.length + 1);
      expect(calls['create']?.[0]).toEqual({ name: `sbx-${uuid}`, tenantId: TENANT });
      expect(calls['waitUntilRunning']?.[0]).toMatchObject({ name: `sbx-${uuid}` });
    });

    it('generates a distinct id for every sandbox', async () => {
      const { backend } = fakeBackend();
      const { client } = fakeExecClient([]);
      const p = provider({ backend, execClient: client });
      const a = await p.createSandbox();
      const b = await p.createSandbox();
      expect(a.sandboxId).not.toBe(b.sandboxId);
    });
  });

  describe('exec', () => {
    it('rejects a sandboxId belonging to a different tenant without touching the backend', async () => {
      const { backend, calls } = fakeBackend();
      const { client } = fakeExecClient([]);
      const p = provider({ backend, execClient: client });

      await expect(p.exec({ sandboxId: 'other-tenant.abc', command: 'true' })).rejects.toMatchObject({
        statusCode: 403,
      });
      expect(calls['getRunningPod']).toEqual([]);
    });

    it('propagates SandboxNotAvailableError from the backend unwrapped, not as a failed ExecResult', async () => {
      const { SandboxNotAvailableError } = await import('@truefoundry/trueforge-core/core');
      const { backend } = fakeBackend({
        getRunningPod: () => {
          throw new SandboxNotAvailableError('ns/sbx-x');
        },
      });
      const { client } = fakeExecClient([]);
      const p = provider({ backend, execClient: client });

      await expect(p.exec({ sandboxId: `${TENANT}.x`, command: 'true' })).rejects.toBeInstanceOf(
        SandboxNotAvailableError,
      );
    });

    it('probes pwd/$PATH once, then reuses the cached layout on later execs', async () => {
      const { backend } = fakeBackend();
      const { client, calls } = fakeExecClient([
        { stdout: '/home/trueforge\n/usr/bin:/bin\n' },
        { stdout: 'ok\n' },
        { stdout: 'ok\n' },
      ]);
      const p = provider({ backend, execClient: client });

      await p.exec({ sandboxId: `${TENANT}.x`, command: 'echo 1' });
      await p.exec({ sandboxId: `${TENANT}.x`, command: 'echo 2' });

      // 1 probe + 2 real execs = 3 calls, not 4 — the second exec skips the probe.
      expect(calls).toHaveLength(3);
      expect(calls[0]?.argv).toEqual(['sh', '-c', 'printf \'%s\\n%s\\n\' "$(pwd)" "$PATH"']);
    });

    it('absolutizes PATH with mcp-client/bin ahead of the discovered PATH, and passes cwd through', async () => {
      const { backend } = fakeBackend();
      const { client, calls } = fakeExecClient([{ stdout: '/home/trueforge\n/usr/bin:/bin\n' }, { stdout: 'ok\n' }]);
      const p = provider({ backend, execClient: client });

      await p.exec({ sandboxId: `${TENANT}.x`, command: 'ls', cwd: 'skills' });

      // absolutizeRelativeExecEnv prepends the discovered root to every relative PATH segment.
      const script = calls[1]?.argv[2] ?? '';
      expect(script).toContain("export PATH='/home/trueforge/mcp-client/bin:/usr/bin:/bin'");
      expect(script).toContain("cd 'skills'");
      expect(script.endsWith('\nls')).toBe(true);
    });

    it('combines stdout and stderr into the result on success', async () => {
      const { backend } = fakeBackend();
      const { client } = fakeExecClient([
        { stdout: '/home/trueforge\n\n' },
        { stdout: 'out\n', stderr: 'warn\n', exitCode: 3 },
      ]);
      const p = provider({ backend, execClient: client });

      const result = await p.exec({ sandboxId: `${TENANT}.x`, command: 'true' });

      expect(result).toEqual({ success: true, response: { exitCode: 3, result: 'out\nwarn\n' } });
    });

    it('returns a failed ExecResult (not a throw) when the command itself hits a transport failure', async () => {
      const { backend } = fakeBackend();
      let call = 0;
      // First call is the pwd/$PATH layout probe (must succeed); the second is the real command.
      const client: PodExecClient = {
        exec: params => {
          call += 1;
          if (call === 1) {
            setImmediate(() => {
              params.stdout.write(Buffer.from('/home/trueforge\n\n', 'utf8'));
              params.onStatus({ status: 'Success' });
              params.onClose();
            });
          } else {
            setImmediate(() => params.onError(new Error('stream reset')));
          }
          return Promise.resolve({ close: () => undefined });
        },
      };
      const p = provider({ backend, execClient: client });

      const result = await p.exec({ sandboxId: `${TENANT}.x`, command: 'true' });

      expect(result.success).toBe(false);
      if (result.success) throw new Error('unreachable');
      expect(result.error).toMatch(/stream reset/);
    });

    it('lets a transport failure during the (first-exec-only) layout probe throw, mirroring TFYSandboxProvider', async () => {
      const { backend } = fakeBackend();
      const client: PodExecClient = {
        exec: params => {
          setImmediate(() => params.onError(new Error('stream reset')));
          return Promise.resolve({ close: () => undefined });
        },
      };
      const p = provider({ backend, execClient: client });

      await expect(p.exec({ sandboxId: `${TENANT}.x`, command: 'true' })).rejects.toThrow(/stream reset/);
    });
  });

  describe('downloadFile', () => {
    it('returns the raw bytes without base64', async () => {
      const { backend } = fakeBackend();
      const payload = Buffer.from([0, 1, 2, 253, 254, 255]);
      const { client, calls } = fakeExecClient([
        { stdout: JSON.stringify({ size: payload.length, type: 'regular file' }) },
        { stdout: payload },
      ]);
      const p = provider({ backend, execClient: client });

      const downloaded = await p.downloadFile({ sandboxId: `${TENANT}.x`, path: 'out.bin' });

      expect(Buffer.compare(downloaded, payload)).toBe(0);
      expect(calls[1]?.argv[2]).toBe("cat 'out.bin'");
      expect(JSON.stringify(calls.map(c => c.argv))).not.toMatch(/base64/);
    });

    it('rejects with SandboxFileTooLargeError before downloading, when stat reports an oversize file', async () => {
      const { backend } = fakeBackend();
      const { client, calls } = fakeExecClient([{ stdout: JSON.stringify({ size: 2_000_000, type: 'regular file' }) }]);
      const p = provider({ backend, execClient: client });

      await expect(p.downloadFile({ sandboxId: `${TENANT}.x`, path: 'big.bin' })).rejects.toBeInstanceOf(
        SandboxFileTooLargeError,
      );
      expect(calls).toHaveLength(1);
    });

    it('rejects with SandboxPathIsDirectoryError for a directory', async () => {
      const { backend } = fakeBackend();
      const { client } = fakeExecClient([{ stdout: JSON.stringify({ size: 0, type: 'directory' }) }]);
      const p = provider({ backend, execClient: client });

      await expect(p.downloadFile({ sandboxId: `${TENANT}.x`, path: 'dir' })).rejects.toBeInstanceOf(
        SandboxPathIsDirectoryError,
      );
    });

    it('rejects with SandboxFileNotFoundError when stat exits non-zero', async () => {
      const { backend } = fakeBackend();
      const { client } = fakeExecClient([{ stdout: '', exitCode: 1 }]);
      const p = provider({ backend, execClient: client });

      await expect(p.downloadFile({ sandboxId: `${TENANT}.x`, path: 'missing' })).rejects.toBeInstanceOf(
        SandboxFileNotFoundError,
      );
    });
  });

  describe('uploadFile', () => {
    it('streams the content over stdin to a cat redirect, without base64', async () => {
      const { backend } = fakeBackend();
      const payload = Buffer.from([0, 10, 250, 255]);
      const { client, calls } = fakeExecClient([{ exitCode: 0 }]);
      const p = provider({ backend, execClient: client });

      await p.uploadFile({ sandboxId: `${TENANT}.x`, remotePath: 'in.bin', content: payload });

      expect(calls[0]?.argv[2]).toBe("cat > 'in.bin'");
      expect(Buffer.compare(calls[0]?.stdin ?? Buffer.alloc(0), payload)).toBe(0);
    });

    it('throws on a non-zero exit code', async () => {
      const { backend } = fakeBackend();
      const { client } = fakeExecClient([{ exitCode: 1, stderr: 'disk full' }]);
      const p = provider({ backend, execClient: client });

      await expect(
        p.uploadFile({ sandboxId: `${TENANT}.x`, remotePath: 'in.bin', content: Buffer.from('x') }),
      ).rejects.toThrow(/disk full/);
    });
  });

  it('exposes cwd-relative layout paths with no FS jail', () => {
    const { backend } = fakeBackend();
    const { client } = fakeExecClient([]);
    const p = provider({ backend, execClient: client });

    expect(p.getSkillsDir()).toBe('skills');
    expect(p.getFileUploadsDir()).toBe('uploads');
    expect(p.getToolResultDumpDir()).toBe('tool-results');
    expect(p.getGitCredentialsPath()).toBe('.git-credentials');
    expect(p.getSkillDownloaderPath()).toBe('skill_downloader.py');
  });

  describe('createCodeModeTransport', () => {
    it('installs the mcp client at the cwd-relative path', () => {
      const { backend } = fakeBackend();
      const { client } = fakeExecClient([]);
      const p = provider({ backend, execClient: client });

      const transport = p.createCodeModeTransport();

      expect(transport.getClientInstall({ sandboxId: 'x' }).remotePath).toBe('mcp-client/mcp_client.py');
    });
  });
});
