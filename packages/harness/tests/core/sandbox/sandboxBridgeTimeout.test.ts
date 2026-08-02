jest.mock('../../../src/core/sandbox/SandboxNatsBridge', () => {
  const actual = jest.requireActual('../../../src/core/sandbox/SandboxNatsBridge');
  return {
    ...actual,
    SandboxNatsBridge: { connect: jest.fn() },
  };
});

import { REQUEST_TIMEOUT_MS } from '../../../src/core/mcp/remoteMcpClient';
import type { ExecResult, SandboxExecParams, SandboxProvider } from '../../../src/core/sandbox/provider/Provider';
import {
  Sandbox,
  SANDBOX_BRIDGE_EXEC_TIMEOUT_SECONDS,
  SANDBOX_EXEC_TOOL_NAME,
} from '../../../src/core/sandbox/Sandbox';
import { SANDBOX_BRIDGE_REQUEST_TIMEOUT_MS, SandboxNatsBridge } from '../../../src/core/sandbox/SandboxNatsBridge';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import { makeMockIMCPServer, makeSilentLogger } from '../harnessMocks';

const mockBridgeConnect = SandboxNatsBridge.connect as jest.Mock;
const AGENT_COMMAND = 'echo hello';

function makeSandbox(): { sandbox: Sandbox; execCalls: SandboxExecParams[] } {
  const execCalls: SandboxExecParams[] = [];
  const provider: SandboxProvider = {
    createSandbox: () => Promise.resolve({ sandboxId: 'test-tenant.sandbox-1' }),
    exec: (params): Promise<ExecResult> => {
      execCalls.push(params);
      return Promise.resolve({ success: true, response: { exitCode: 0, result: '' } });
    },
    getAdditionalInstructions: () => undefined,
    getToolResultDumpDir: () => '/tmp/tool-results',
    getGitCredentialsPath: () => '/tmp/.git-credentials',
    downloadFile: jest.fn(),
    uploadFile: jest.fn(),
    getNatsBridgeUrl: () => Promise.resolve('ws://localhost:4444'),
  };
  return {
    sandbox: new Sandbox({
      provider,
      blockDestructiveToolsInCodeMode: true,
      execExtraEnv: { TFY_TENANT_NAME: 'test-tenant' },
      logger: makeSilentLogger(),
      tracing: NOOP_AGENT_TRACING,
    }),
    execCalls,
  };
}

async function execAgentCommand(sandbox: Sandbox, execCalls: SandboxExecParams[]): Promise<SandboxExecParams> {
  await sandbox.callTool({
    name: SANDBOX_EXEC_TOOL_NAME,
    arguments: { intent: 'Run command', command: AGENT_COMMAND },
  });
  const call = execCalls.find(item => item.command === AGENT_COMMAND);
  if (!call) throw new Error('Expected agent command');
  return call;
}

describe('Code Mode timeout chain', () => {
  beforeEach(() => {
    mockBridgeConnect.mockReset();
    mockBridgeConnect.mockResolvedValue({
      subjectPrefix: 'sandbox.bridge.test',
      whenClosed: () => new Promise<void>(() => {}),
      close: () => Promise.resolve(),
    });
  });

  it('keeps each outer timeout longer than the work it wraps', () => {
    expect(REQUEST_TIMEOUT_MS).toBe(300_000);
    expect(SANDBOX_BRIDGE_REQUEST_TIMEOUT_MS).toBe(330_000);
    expect(SANDBOX_BRIDGE_EXEC_TIMEOUT_SECONDS).toBe(360);
  });

  it('uses the derived bridge and exec timeouts when MCP is available', async () => {
    const { sandbox, execCalls } = makeSandbox();
    sandbox.configureCodeMode([makeMockIMCPServer({ name: 'github', preload: true })]);

    const call = await execAgentCommand(sandbox, execCalls);

    expect(call.env?.['TFY_NATS_REQUEST_TIMEOUT_SECONDS']).toBe('330');
    expect(call.timeoutSeconds).toBe(360);
  });

  it('keeps the provider default when MCP is unavailable', async () => {
    const { sandbox, execCalls } = makeSandbox();

    const call = await execAgentCommand(sandbox, execCalls);

    expect(call.env?.['TFY_NATS_REQUEST_TIMEOUT_SECONDS']).toBeUndefined();
    expect(call.timeoutSeconds).toBeUndefined();
  });
});
