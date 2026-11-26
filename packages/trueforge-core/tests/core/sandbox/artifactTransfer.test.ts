import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  artifactTransferScriptPath,
  artifactUploadRequestPath,
  buildArtifactUploadRequestFile,
} from '../../../src/core/sandbox/artifactTransfer';
import type { ExecResult, SandboxExecParams, SandboxProvider } from '../../../src/core/sandbox/provider/Provider';
import { Sandbox } from '../../../src/core/sandbox/Sandbox';
import { sandboxScripts } from '../../../src/core/sandbox/sandboxScripts.gen';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import { makeSilentLogger } from '../harnessMocks';

describe('artifact_transfer_v1.py', () => {
  let root: string;
  let transferDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'artifact-transfer-'));
    transferDir = join(root, 'tfg', 'artifacts');
    mkdirSync(join(transferDir, 'uploads'), { recursive: true });
    writeFileSync(artifactTransferScriptPath(transferDir), sandboxScripts.artifactTransfer);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function run(mode: string, arg: string): { status: number | null; output: Record<string, unknown> | undefined } {
    const result = spawnSync('python3', [artifactTransferScriptPath(transferDir), mode, arg], { encoding: 'utf-8' });
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

  it('validate returns size and sha256 for every file under the dir', () => {
    const { status, output } = run('validate', makeReport());
    expect(status).toBe(0);
    expect(output).toEqual({
      mode: 'validate',
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

  it('validate skips file and dir symlinks', () => {
    const report = makeReport();
    symlinkSync('/etc/passwd', join(report, 'passwd.txt'));
    symlinkSync('/etc', join(report, 'etc'));
    const { status, output } = run('validate', report);
    expect(status).toBe(0);
    expect(output).toMatchObject({ success: true, error: null });
    expect((output?.['files'] as { relative_path: string }[]).map(f => f.relative_path)).toEqual([
      'img/chart.png',
      'index.html',
    ]);
  });

  it('validate rejects a missing dir', () => {
    const { output } = run('validate', join(root, 'nope'));
    expect(output).toMatchObject({ success: false, exit_code: 1, error: expect.stringContaining('not a directory') });
  });

  it('upload deletes its request file and reports per-file status', () => {
    const report = makeReport();
    const requestPath = artifactUploadRequestPath({ transferDir, requestId: 'r1' });
    writeFileSync(
      requestPath,
      buildArtifactUploadRequestFile({
        concurrency: 2,
        base_path: report,
        files: [
          { relative_path: 'index.html', url: 'http://127.0.0.1:1/a', headers: { 'content-length': '5' } },
          { relative_path: '../escape.txt', url: 'http://127.0.0.1:1/b', headers: { 'Content-Length': '1' } },
        ],
      }),
    );
    const { status, output } = run('upload', requestPath);
    expect(status).toBe(1);
    expect(existsSync(requestPath)).toBe(false);
    expect(output).toEqual({
      mode: 'upload',
      success: false,
      exit_code: 1,
      files: [
        { path: 'index.html', status: null, error: expect.stringContaining('network:') },
        { path: '../escape.txt', status: null, error: 'invalid_relative_path' },
      ],
    });
  });

  it('removes request files older than 5 minutes and keeps recent or unreadable ones', () => {
    const write = (name: string, content: string): string => {
      const path = join(transferDir, 'uploads', name);
      writeFileSync(path, content);
      return path;
    };
    const stale = write('stale.json', JSON.stringify({ created_at: new Date(Date.now() - 6 * 60_000).toISOString() }));
    const recent = write('recent.json', JSON.stringify({ created_at: new Date().toISOString() }));
    const partial = write('partial.json', '{"files": [');

    expect(run('validate', makeReport()).status).toBe(0);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(recent)).toBe(true);
    expect(existsSync(partial)).toBe(true);
  });

  it('exits 2 on a malformed request', () => {
    expect(run('validate', 'relative/dir').status).toBe(2);
  });
});

describe('Sandbox artifact transfer', () => {
  const TRANSFER_DIR = '/prov/tfg/artifacts';
  const SCRIPT = `${TRANSFER_DIR}/artifact_transfer_v1.py`;
  const VALIDATE_OUTPUT = { mode: 'validate', success: true, exit_code: 0, error: null, files: [] };
  const UPLOAD_OUTPUT = { mode: 'upload', success: true, exit_code: 0, files: [] };

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
        const output = params.command.includes(' validate ')
          ? VALIDATE_OUTPUT
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
      getArtifactTransferDir: () => TRANSFER_DIR,
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

  it('validate copies the script and runs it on the dir in one exec', async () => {
    const { sandbox, execs, uploads } = makeSandbox();
    const run = await sandbox.validateArtifactDir("/home/trueforge/it's");

    expect(run.result).toEqual(VALIDATE_OUTPUT);
    expect(run.sandboxCreated).toBe(true);
    expect(uploads).toEqual([SCRIPT]);
    const command = execs.at(-1)?.command;
    expect(command).toContain(`umask 077 && mkdir -p '${TRANSFER_DIR}/uploads'`);
    expect(command).toContain(`python3 '${SCRIPT}' validate '/home/trueforge/it'\\''s'`);
  });

  it('upload copies the script and request, then runs and deletes the request in one exec', async () => {
    const { sandbox, execs, uploads } = makeSandbox();
    const run = await sandbox.uploadArtifactFiles({
      requestId: 'p1',
      request: { concurrency: 4, base_path: '/home/trueforge/report', files: [] },
    });

    const requestPath = `${TRANSFER_DIR}/uploads/uploadFile_p1.json`;
    expect(run.result).toEqual(UPLOAD_OUTPUT);
    expect(uploads).toEqual([SCRIPT, requestPath]);
    const last = execs.at(-1);
    expect(last?.command).toBe(`python3 '${SCRIPT}' upload '${requestPath}'; rc=$?; rm -f '${requestPath}'; exit $rc`);
    expect(last?.timeoutSeconds).toBe(300);
  });
});
