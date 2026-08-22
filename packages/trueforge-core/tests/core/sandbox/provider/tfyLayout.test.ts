import { absolutizeRelativeExecEnv } from '../../../../src/core/sandbox/provider/execEnv';
import { SANDBOX_EXEC_ABORTED_ERROR } from '../../../../src/core/sandbox/provider/Provider';
import { TFYSandboxProvider, withMcpClientOnPath } from '../../../../src/core/sandbox/provider/TFYSandboxProvider';
import { makeSilentLogger } from '../../harnessMocks';

afterEach(() => {
  jest.restoreAllMocks();
});

describe('TFYSandboxProvider layout', () => {
  it('keeps exec writes cwd-relative (no extra FS jail)', () => {
    const provider = new TFYSandboxProvider({
      serverUrl: 'http://sandbox.example',
      natsBridgeUrl: 'ws://nats.example',
      tenantName: 'acme',
      fileMaxBytesForDownload: 1024,
      logger: makeSilentLogger(),
    });
    const sandboxId = 'acme.00000000-0000-0000-0000-000000000001';
    const layout = [
      provider.getToolResultDumpDir(),
      provider.getGitCredentialsPath(),
      provider.getFileUploadsDir(),
      provider.getSkillsDir(),
      provider.getGitDownloaderPath(),
    ];
    for (const path of layout) {
      expect(path.startsWith('/')).toBe(false);
    }
    const install = provider.createCodeModeTransport().getClientInstall({ sandboxId });
    expect(install.remotePath.startsWith('/')).toBe(false);
    expect(install.pathBinSymlink).toBeUndefined();
    const instructions = provider.getAdditionalInstructions();
    expect(instructions).toContain('uploads, skills, and tool-results live in the sandbox working directory');
    expect(instructions).not.toContain('/data/sandboxes');
  });

  it('absolutizes GIT_CONFIG store --file and PATH for git/mcp-client after cd', () => {
    const env = absolutizeRelativeExecEnv({
      root: '/discovered/root',
      env: {
        GIT_CONFIG_VALUE_0: 'store --file .git-credentials',
        PATH: 'mcp-client/bin:/usr/bin',
        PYTHONPATH: 'mcp-client',
        TFY_SKILLS_DIR: 'skills',
        TFY_NATS_URL: 'ws://localhost',
      },
    });
    expect(env['GIT_CONFIG_VALUE_0']).toBe('store --file /discovered/root/.git-credentials');
    expect(env['PATH']).toBe('/discovered/root/mcp-client/bin:/usr/bin');
    expect(env['PYTHONPATH']).toBe('/discovered/root/mcp-client');
    expect(env['TFY_SKILLS_DIR']).toBe('/discovered/root/skills');
    expect(env['TFY_NATS_URL']).toBe('ws://localhost');
  });

  it('puts mcp-client/bin first on PATH without duplicating it', () => {
    expect(withMcpClientOnPath('')).toBe('mcp-client/bin');
    expect(withMcpClientOnPath('/usr/bin:/bin')).toBe('mcp-client/bin:/usr/bin:/bin');
    expect(withMcpClientOnPath('mcp-client/bin:/usr/bin')).toBe('mcp-client/bin:/usr/bin');
  });

  it('aborts the exec fetch when the turn signal aborts', async () => {
    const provider = new TFYSandboxProvider({
      serverUrl: 'http://sandbox.example',
      natsBridgeUrl: 'ws://nats.example',
      tenantName: 'acme',
      fileMaxBytesForDownload: 1024,
      logger: makeSilentLogger(),
    });
    const sandboxId = 'acme.00000000-0000-0000-0000-000000000001';
    const fetchMock = jest.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          success: true,
          response: { exitCode: 0, result: '/sandbox/root\n/usr/bin\n' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const execFetchStarted = new Promise<void>(resolve => {
      fetchMock.mockImplementationOnce((_url, init) => {
        const signal = init?.signal;
        if (signal === undefined || signal === null) {
          return Promise.reject(new Error('Expected fetch signal'));
        }
        resolve();
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener(
            'abort',
            () => {
              const error = new Error('Aborted');
              error.name = 'AbortError';
              reject(error);
            },
            { once: true },
          );
        });
      });
    });
    const controller = new AbortController();

    const exec = provider.exec({ sandboxId, command: 'sleep 60', signal: controller.signal });
    await execFetchStarted;
    controller.abort();

    await expect(exec).resolves.toEqual({ success: false, error: SANDBOX_EXEC_ABORTED_ERROR });
  });
});
