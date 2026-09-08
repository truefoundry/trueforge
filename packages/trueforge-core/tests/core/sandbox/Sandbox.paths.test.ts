import { InstructionBuilder } from '../../../src/core/InstructionBuilder';
import type { CodeModeTransport } from '../../../src/core/sandbox/codeMode/CodeModeTransport';
import type { ExecResult, SandboxExecParams, SandboxProvider } from '../../../src/core/sandbox/provider/Provider';
import { SANDBOX_EXEC_TOOL_NAME, Sandbox } from '../../../src/core/sandbox/Sandbox';
import { REQUESTED_SKILLS_FILE_NAME, SkillMounter, type GitSkill } from '../../../src/core/sandbox/skills/SkillMounter';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import { makeMockIMCPServer, makeSilentLogger } from '../harnessMocks';

function readyExec(): Promise<ExecResult> {
  return Promise.resolve({ success: true, response: { exitCode: 0, result: 'ok' } });
}

function makeProvider(overrides: Partial<SandboxProvider> = {}): SandboxProvider {
  return {
    type: 'test',
    buildImage: () => Promise.resolve({ status: 'ready', reason: null, metadata: null }),
    getImageBuildStatus: () => Promise.resolve({ status: 'ready', reason: null, metadata: null }),
    createSandbox: () => Promise.resolve({ sandboxId: 'raw-1' }),
    exec: () => readyExec(),
    getAdditionalInstructions: () => undefined,
    getToolResultDumpDir: () => '/prov/tool-results',
    getGitCredentialsPath: () => '/prov/.git-credentials',
    getFileUploadsDir: () => '/prov/uploads',
    getSkillsDir: () => '/prov/skills',
    getGitDownloaderPath: () => '/prov/git_downloader.py',
    downloadFile: jest.fn(),
    uploadFile: jest.fn().mockResolvedValue(undefined),
    createCodeModeTransport: jest.fn(),
    ...overrides,
  };
}

function makeSandbox(
  provider: SandboxProvider,
  options: { existingSandboxId?: string; skillMounter?: SkillMounter } = {},
): Sandbox {
  return new Sandbox({
    provider,
    existingSandboxId: options.existingSandboxId,
    skillMounter: options.skillMounter,
    blockDestructiveToolsInCodeMode: true,
    mcpRequestTimeoutMs: 60_000,
    mcpConnectTimeoutMs: 5_000,
    logger: makeSilentLogger(),
    tracing: NOOP_AGENT_TRACING,
  });
}

describe('Sandbox provider-owned paths', () => {
  it('puts the provider uploads dir in the system prompt, not /tmp/uploads', () => {
    const sandbox = makeSandbox(makeProvider());
    const builder = new InstructionBuilder('root');
    sandbox.buildInstruction(builder);
    const prompt = builder.build();
    expect(prompt).toContain('/prov/uploads/');
    expect(prompt).not.toContain('/tmp/uploads');
  });

  it('uploads user files to the provider uploads dir', async () => {
    const uploadFile = jest.fn().mockResolvedValue(undefined);
    const provider = makeProvider({ uploadFile });
    const sandbox = makeSandbox(provider);
    const stored = await sandbox.uploadUserFile({
      fileName: 'notes.txt',
      content: Buffer.from('hi'),
      mime: 'text/plain',
    });
    expect(stored.filePath).toBe('/prov/uploads/notes.txt');
    expect(uploadFile).toHaveBeenCalledWith({
      sandboxId: 'raw-1',
      remotePath: '/prov/uploads/notes.txt',
      content: Buffer.from('hi'),
    });
  });

  it('uploads skill-init files from the mounter before the skill init exec', async () => {
    const events: string[] = [];
    const uploadFile = jest.fn().mockImplementation(async (args: { remotePath: string }) => {
      if (args.remotePath === `/prov/skills/${REQUESTED_SKILLS_FILE_NAME}`) {
        events.push('skill-upload');
      }
    });
    const exec = jest.fn().mockImplementation((params: SandboxExecParams): Promise<ExecResult> => {
      if (params.env?.['TFY_SKILLS_DIR'] === '/prov/skills') {
        events.push('skill-init-exec');
      }
      return readyExec();
    });
    const gitSkill = {
      type: 'git',
      name: 'echo',
      description: 'Echo',
      url: 'https://github.com/acme/skills.git',
      path: '',
      ref: 'a'.repeat(40),
    } satisfies GitSkill;
    const sandbox = makeSandbox(makeProvider({ uploadFile, exec }), {
      skillMounter: new SkillMounter({ skills: [gitSkill] }),
    });

    await sandbox.uploadUserFile({
      fileName: 'notes.txt',
      content: Buffer.from('hi'),
      mime: 'text/plain',
    });

    const skillsUpload = uploadFile.mock.calls
      .map((call: unknown[]) => call[0] as { remotePath: string; content: Buffer; sandboxId: string })
      .find(args => args.remotePath === `/prov/skills/${REQUESTED_SKILLS_FILE_NAME}`);
    expect(skillsUpload).toBeDefined();
    if (skillsUpload === undefined) {
      return;
    }
    expect(skillsUpload).toEqual({
      sandboxId: 'raw-1',
      remotePath: `/prov/skills/${REQUESTED_SKILLS_FILE_NAME}`,
      content: expect.any(Buffer),
    });
    expect(JSON.parse(skillsUpload.content.toString('utf-8'))).toEqual({
      skills: [
        {
          type: 'git',
          name: 'echo',
          url: gitSkill.url,
          path: '',
          ref: gitSkill.ref,
        },
      ],
    });
    expect(events.indexOf('skill-upload')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('skill-init-exec')).toBeGreaterThan(events.indexOf('skill-upload'));
    expect(
      exec.mock.calls.some((call: unknown[]) => {
        const params = call[0] as SandboxExecParams;
        return (
          params.env?.['TFY_SKILLS_DIR'] === '/prov/skills' &&
          params.timeoutSeconds === 180 &&
          typeof params.command === 'string' &&
          params.command.includes('/prov/git_downloader.py')
        );
      }),
    ).toBe(true);
  });

  it('does not rewrite a caller PATH (providers own PATH)', async () => {
    const execCalls: SandboxExecParams[] = [];
    const transport: CodeModeTransport = {
      getClientInstall: () => ({
        content: 'print("mock")\n',
        remotePath: 'mcp-client/mcp_client.py',
      }),
      start: () =>
        Promise.resolve({
          env: { TFY_NATS_URL: 'ws://localhost:4223', TFY_NATS_SUBJECT_PREFIX: 'sandbox.bridge.test' },
        }),
      stop: () => Promise.resolve(),
    };
    const sandbox = makeSandbox(
      makeProvider({
        exec: (params): Promise<ExecResult> => {
          execCalls.push(params);
          return readyExec();
        },
        uploadFile: jest.fn().mockResolvedValue(undefined),
        createCodeModeTransport: () => transport,
      }),
    );
    sandbox.configureCodeMode([makeMockIMCPServer({ name: 'github', preload: true })]);
    await sandbox.callTool({
      name: SANDBOX_EXEC_TOOL_NAME,
      arguments: { intent: 'Run command', command: 'true', env: { PATH: '/usr/bin' } },
    });
    const call = execCalls.find(item => item.command === 'true');
    expect(call?.env?.['PATH']).toBe('/usr/bin');
    expect(call?.env?.['PYTHONPATH']).toBe('mcp-client');
    const init = execCalls.find(item => item.command.includes('ln -sf'));
    expect(init?.command).toContain("ln -sf '../mcp_client.py'");
    expect(init?.command).toContain('mcp-client/bin/mcp-client');
  });
});
