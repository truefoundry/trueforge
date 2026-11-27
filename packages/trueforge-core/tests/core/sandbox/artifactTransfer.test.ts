import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { artifactUploadRequestPath, buildArtifactUploadRequestFile } from '../../../src/core/sandbox/artifactTransfer';
import type { ExecResult, SandboxExecParams, SandboxProvider } from '../../../src/core/sandbox/provider/Provider';
import { Sandbox } from '../../../src/core/sandbox/Sandbox';
import { sandboxScripts } from '../../../src/core/sandbox/sandboxScripts.gen';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import { makeSilentLogger } from '../harnessMocks';

describe('artifact_transfer_v1.py', () => {
  let root: string;
  let scriptPath: string;
  let artifactsDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'artifact-transfer-'));
    scriptPath = join(root, 'artifact_transfer_v1.py');
    artifactsDir = join(root, 'artifacts');
    mkdirSync(join(artifactsDir, 'uploads'), { recursive: true });
    writeFileSync(scriptPath, sandboxScripts.artifactTransfer);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(mode: string, arg: string): { status: number | null; output: Record<string, unknown> | undefined } {
    const result = spawnSync('python3', [scriptPath, mode, arg], { encoding: 'utf-8' });
    return {
      status: result.status,
      output: result.stdout === '' ? undefined : (JSON.parse(result.stdout) as Record<string, unknown>),
    };
  }

  function makeReport(): string {
    const report = join(root, 'report');
    mkdirSync(join(report, 'img'), { recursive: true });
    writeFileSync(join(report, 'index.html'), 'hello');
    writeFileSync(join(report, 'img', 'chart.png'), 'png');
    return report;
  }

  it('metadata returns size and sha256 for every file under the dir', () => {
    const { status, output } = run('metadata', makeReport());
    expect(status).toBe(0);
    expect(output).toEqual({
      success: true,
      exit_code: 0,
      error: null,
      files: [
        { relative_path: 'img/chart.png', size_bytes: 3, sha256_b64: expect.any(String) },
        {
          relative_path: 'index.html',
          size_bytes: 5,
          sha256_b64: 'LPJNul+wow4m6DsqxbninhsWHlwfp0JecwQzYpOLmCQ=',
        },
      ],
    });
  });

  it('metadata skips file and dir symlinks', () => {
    const report = makeReport();
    symlinkSync('/etc/passwd', join(report, 'passwd.txt'));
    symlinkSync('/etc', join(report, 'etc'));
    const { status, output } = run('metadata', report);
    expect(status).toBe(0);
    expect(output).toMatchObject({ success: true, error: null });
    expect((output?.['files'] as { relative_path: string }[]).map(f => f.relative_path)).toEqual([
      'img/chart.png',
      'index.html',
    ]);
  });

  it('metadata rejects a missing dir', () => {
    const { output } = run('metadata', join(root, 'nope'));
    expect(output).toMatchObject({ success: false, exit_code: 1, error: expect.stringContaining('not a directory') });
  });

  it('upload deletes its request file and reports per-file status', () => {
    const report = makeReport();
    const requestPath = artifactUploadRequestPath({ artifactsDir, requestId: 'r1' });
    writeFileSync(
      requestPath,
      buildArtifactUploadRequestFile({
        concurrency: 2,
        base_path: report,
        files: [
          { relative_path: 'index.html', url: 'http://127.0.0.1:1/a', headers: { 'content-length': '5' } },
          { relative_path: 'missing.txt', url: 'http://127.0.0.1:1/b', headers: { 'Content-Length': '1' } },
        ],
      }),
    );
    const { status, output } = run('upload', requestPath);
    expect(status).toBe(1);
    expect(existsSync(requestPath)).toBe(false);
    expect(output).toEqual({
      success: false,
      exit_code: 1,
      files: [
        { path: 'index.html', status: null, error: expect.stringContaining('network:') },
        { path: 'missing.txt', status: null, error: expect.stringContaining('read_failed:') },
      ],
    });
  });

  it('upload reports an invalid HTTP response as a per-file network error', async () => {
    const server = createServer(socket => {
      socket.on('data', () => socket.end('garbage\r\n\r\n'));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const port = typeof address === 'object' && address !== null ? address.port : 0;
    const requestPath = artifactUploadRequestPath({ artifactsDir, requestId: 'r1' });
    writeFileSync(
      requestPath,
      buildArtifactUploadRequestFile({
        concurrency: 1,
        base_path: makeReport(),
        files: [{ relative_path: 'index.html', url: `http://127.0.0.1:${port}/a`, headers: {} }],
      }),
    );
    try {
      const child = spawn('python3', [scriptPath, 'upload', requestPath]);
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
      const status = await new Promise<number | null>(resolve => child.on('close', resolve));
      expect(status).toBe(1);
      expect(JSON.parse(stdout)).toMatchObject({
        files: [{ path: 'index.html', status: null, error: expect.stringContaining('network:') }],
      });
    } finally {
      server.close();
    }
  });

  it('upload removes request files older than the URL lifetime and keeps recent or unreadable ones', () => {
    const write = (name: string, content: string): string => {
      const path = join(artifactsDir, 'uploads', name);
      writeFileSync(path, content);
      return path;
    };
    const stale = write('stale.json', JSON.stringify({ created_at: new Date(Date.now() - 6 * 60_000).toISOString() }));
    const recent = write('recent.json', JSON.stringify({ created_at: new Date().toISOString() }));
    const partial = write('partial.json', '{"files": [');

    const requestPath = artifactUploadRequestPath({ artifactsDir, requestId: 'r1' });
    writeFileSync(requestPath, buildArtifactUploadRequestFile({ concurrency: 2, base_path: makeReport(), files: [] }));
    expect(run('upload', requestPath).status).toBe(2);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(partial)).toBe(true);
  });

  it('exits 2 on a malformed request', () => {
    expect(run('metadata', 'relative/dir').status).toBe(2);
  });

  it('upload exits 2 on an empty file list', () => {
    const requestPath = artifactUploadRequestPath({ artifactsDir, requestId: 'r1' });
    writeFileSync(requestPath, buildArtifactUploadRequestFile({ concurrency: 2, base_path: makeReport(), files: [] }));
    expect(run('upload', requestPath)).toEqual({ status: 2, output: undefined });
  });
});

describe('Sandbox artifact transfer', () => {
  const ARTIFACTS_DIR = '/prov/artifacts';
  const SCRIPT = '/prov/artifact_transfer_v1.py';
  const METADATA_OUTPUT = { success: true, exit_code: 0, error: null, files: [] };
  const UPLOAD_OUTPUT = { success: true, exit_code: 0, files: [] };

  function makeSandbox(): { sandbox: Sandbox; execs: SandboxExecParams[]; uploads: string[] } {
    const execs: SandboxExecParams[] = [];
    const uploads: string[] = [];
    const unsupported = () => Promise.reject(new Error('unsupported'));
    const provider: SandboxProvider = {
      type: 'test',
      envSupported: false,
      createSandbox: () => Promise.resolve({ sandboxId: 'raw-1' }),
      createSecret: unsupported,
      updateSecret: unsupported,
      deleteSecret: unsupported,
      exec: (params): Promise<ExecResult> => {
        execs.push(params);
        const output = params.command.includes(' metadata ')
          ? METADATA_OUTPUT
          : params.command.includes(' upload ')
            ? UPLOAD_OUTPUT
            : undefined;
        const result = output === undefined ? '' : JSON.stringify(output);
        return Promise.resolve({ success: true, response: { exitCode: 0, result } });
      },
      getAdditionalInstructions: () => undefined,
      getToolResultDumpDir: () => '/prov/tool-results',
      getGitCredentialsPath: () => '/prov/.git-credentials',
      getFileUploadsDir: () => '/prov/uploads',
      getSkillsDir: () => '/prov/skills',
      getSkillDownloaderPath: () => '/prov/skill_downloader.py',
      getArtifactTransferPath: () => SCRIPT,
      getArtifactsDir: () => ARTIFACTS_DIR,
      downloadFile: jest.fn(),
      uploadFile: params => {
        uploads.push(params.remotePath);
        return Promise.resolve();
      },
      createCodeModeTransport: jest.fn(),
    };
    const sandbox = new Sandbox({
      provider,
      blockDestructiveToolsInCodeMode: true,
      mcpRequestTimeoutMs: 60_000,
      mcpConnectTimeoutMs: 5_000,
      logger: makeSilentLogger(),
      tracing: NOOP_AGENT_TRACING,
    });
    return { sandbox, execs, uploads };
  }

  it('metadata copies the script and runs it on the dir in one exec', async () => {
    const { sandbox, execs, uploads } = makeSandbox();
    const run = await sandbox.gatherArtifactDirMetadata("/home/trueforge/it's");

    expect(run.result).toEqual(METADATA_OUTPUT);
    expect(run.sandboxCreated).toBe(true);
    expect(uploads).toEqual([SCRIPT]);
    const command = execs.at(-1)?.command;
    expect(command).toContain(`umask 077 && mkdir -p '${ARTIFACTS_DIR}/uploads'`);
    expect(command).toContain(`python3 '${SCRIPT}' metadata '/home/trueforge/it'\\''s'`);
  });

  it('upload copies the script and request, then runs and deletes the request in one exec', async () => {
    const { sandbox, execs, uploads } = makeSandbox();
    const run = await sandbox.uploadArtifactFiles({
      requestId: 'p1',
      request: { concurrency: 4, base_path: '/home/trueforge/report', files: [] },
    });

    const requestPath = `${ARTIFACTS_DIR}/uploads/uploadFile_p1.json`;
    expect(run.result).toEqual(UPLOAD_OUTPUT);
    expect(uploads).toEqual([SCRIPT, requestPath]);
    const last = execs.at(-1);
    expect(last?.command).toBe(`python3 '${SCRIPT}' upload '${requestPath}'; rc=$?; rm -f '${requestPath}'; exit $rc`);
    expect(last?.timeoutSeconds).toBe(300);
  });
});
