import { InstructionBuilder } from '../../../src/core/InstructionBuilder';
import type { ExecResult, SandboxProvider } from '../../../src/core/sandbox/provider/Provider';
import { Sandbox } from '../../../src/core/sandbox/Sandbox';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import { makeSilentLogger } from '../harnessMocks';

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
  options: { existingSandboxId?: string; sessionId?: string } = {},
): Sandbox {
  return new Sandbox({
    provider,
    existingSandboxId: options.existingSandboxId,
    sessionId: options.sessionId,
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

  it('passes sessionId through to createSandbox', async () => {
    const createSandbox = jest.fn().mockResolvedValue({ sandboxId: 'raw-1' });
    const sandbox = makeSandbox(makeProvider({ createSandbox }), { sessionId: 'sess_1' });
    await sandbox.uploadUserFile({
      fileName: 'a.txt',
      content: Buffer.from('x'),
      mime: 'text/plain',
    });
    expect(createSandbox).toHaveBeenCalledWith({ sessionId: 'sess_1' });
  });
});
