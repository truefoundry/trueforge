import { isCallToolResponseResult } from '../../../src/core/mcp/IMCPServer';
import type { ExecResult, SandboxExecParams, SandboxProvider } from '../../../src/core/sandbox/provider/Provider';
import { SANDBOX_EXEC_TOOL_NAME, Sandbox } from '../../../src/core/sandbox/Sandbox';
import { SandboxNotAvailableError } from '../../../src/core/sandbox/SandboxErrors';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import { makeSilentLogger } from '../harnessMocks';

function readyExec(): Promise<ExecResult> {
  return Promise.resolve({ success: true, response: { exitCode: 0, result: 'ok' } });
}

function makeProvider(
  overrides: Partial<SandboxProvider> & Pick<SandboxProvider, 'createSandbox' | 'exec'>,
): SandboxProvider {
  return {
    type: 'local',
    buildImage: () => Promise.resolve({ status: 'ready', reason: null, metadata: null }),
    getImageBuildStatus: () => Promise.resolve({ status: 'ready', reason: null, metadata: null }),
    getAdditionalInstructions: () => undefined,
    getToolResultDumpDir: sandboxId => `${sandboxId}/tool-results`,
    getGitCredentialsPath: sandboxId => `${sandboxId}/.git-credentials`,
    getFileUploadsDir: sandboxId => `${sandboxId}/uploads`,
    getSkillsDir: sandboxId => `${sandboxId}/skills`,
    getGitDownloaderPath: sandboxId => `${sandboxId}/git_downloader.py`,
    downloadFile: jest.fn(),
    uploadFile: jest.fn().mockResolvedValue(undefined),
    createCodeModeTransport: jest.fn(),
    ...overrides,
  };
}

function makeSandbox(provider: SandboxProvider, existingSandboxId?: string): Sandbox {
  return new Sandbox({
    provider,
    existingSandboxId,
    blockDestructiveToolsInCodeMode: true,
    mcpRequestTimeoutMs: 60_000,
    mcpConnectTimeoutMs: 5_000,
    logger: makeSilentLogger(),
    tracing: NOOP_AGENT_TRACING,
  });
}

describe('Sandbox fancy ids', () => {
  it('wraps createSandbox raw id as v1:type:raw and calls the provider with raw', async () => {
    const execCalls: SandboxExecParams[] = [];
    const provider = makeProvider({
      createSandbox: () => Promise.resolve({ sandboxId: '/tmp/raw-1' }),
      exec: params => {
        execCalls.push(params);
        return readyExec();
      },
    });
    const sandbox = makeSandbox(provider);
    const result = await sandbox.callTool({
      name: SANDBOX_EXEC_TOOL_NAME,
      arguments: { intent: 'pwd', command: 'pwd' },
    });
    if (!isCallToolResponseResult(result)) {
      throw new Error('expected tool result');
    }
    expect(result.sandboxInfo?.sandbox_id).toBe('v1:local:/tmp/raw-1');
    expect(result.sandboxCreated).toBe(true);
    expect(execCalls.every(call => call.sandboxId === '/tmp/raw-1')).toBe(true);
  });

  it('reattaches a fancy id using the raw id and recreates when the provider reports missing', async () => {
    let execCount = 0;
    const provider = makeProvider({
      createSandbox: jest.fn().mockResolvedValue({ sandboxId: '/tmp/raw-2' }),
      exec: params => {
        execCount += 1;
        if (params.sandboxId === '/tmp/gone') {
          throw new SandboxNotAvailableError(params.sandboxId);
        }
        return readyExec();
      },
    });
    const sandbox = makeSandbox(provider, 'v1:local:/tmp/gone');
    const result = await sandbox.callTool({
      name: SANDBOX_EXEC_TOOL_NAME,
      arguments: { intent: 'pwd', command: 'pwd' },
    });
    if (!isCallToolResponseResult(result)) {
      throw new Error('expected tool result');
    }
    expect(provider.createSandbox).toHaveBeenCalled();
    expect(result.sandboxInfo?.sandbox_id).toBe('v1:local:/tmp/raw-2');
    expect(result.sandboxCreated).toBe(true);
    expect(execCount).toBeGreaterThan(1);
  });

  it('passes a legacy existing id through to the provider unchanged', async () => {
    const execCalls: SandboxExecParams[] = [];
    const provider = makeProvider({
      createSandbox: jest.fn(),
      exec: params => {
        execCalls.push(params);
        return readyExec();
      },
    });
    const sandbox = makeSandbox(provider, 'tenant.legacy-id');
    await sandbox.callTool({
      name: SANDBOX_EXEC_TOOL_NAME,
      arguments: { intent: 'pwd', command: 'pwd' },
    });
    expect(provider.createSandbox).not.toHaveBeenCalled();
    expect(execCalls.every(call => call.sandboxId === 'tenant.legacy-id')).toBe(true);
  });
});
