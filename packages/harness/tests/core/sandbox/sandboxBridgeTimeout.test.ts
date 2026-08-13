jest.mock('../../../src/core/sandbox/SandboxNatsBridge', () => {
  const actual = jest.requireActual('../../../src/core/sandbox/SandboxNatsBridge');
  return {
    ...actual,
    SandboxNatsBridge: { connect: jest.fn() },
  };
});

import type { ExecResult, SandboxExecParams, SandboxProvider } from '../../../src/core/sandbox/provider/Provider';
import { Sandbox, SANDBOX_EXEC_TOOL_NAME } from '../../../src/core/sandbox/Sandbox';
import { SandboxNatsBridge } from '../../../src/core/sandbox/SandboxNatsBridge';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import { makeMockIMCPServer, makeSilentLogger } from '../harnessMocks';

const mockBridgeConnect = SandboxNatsBridge.connect as jest.Mock;
const AGENT_COMMAND = 'echo hello';

function makeSandbox(options: { mcpRequestTimeoutMs: number; mcpConnectTimeoutMs: number }): {
  sandbox: Sandbox;
  execCalls: SandboxExecParams[];
} {
  const execCalls: SandboxExecParams[] = [];
  const provider: SandboxProvider = {
    buildImage: () => Promise.resolve({ status: 'ready', reason: null, metadata: null }),
    getImageBuildStatus: () => Promise.resolve({ status: 'ready', reason: null, metadata: null }),
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
      ...options,
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

describe('Code Mode timeouts', () => {
  beforeEach(() => {
    mockBridgeConnect.mockReset();
    mockBridgeConnect.mockResolvedValue({
      subjectPrefix: 'sandbox.bridge.test',
      whenClosed: () => new Promise<void>(() => {}),
      close: () => Promise.resolve(),
    });
  });

  it('derives the NATS wait from MCP request + connect plus a buffer', async () => {
    const { sandbox, execCalls } = makeSandbox({
      mcpRequestTimeoutMs: 90_000,
      mcpConnectTimeoutMs: 30_000,
    });
    sandbox.configureCodeMode([makeMockIMCPServer({ name: 'github', preload: true })]);

    const call = await execAgentCommand(sandbox, execCalls);

    expect(call.env?.['TFY_NATS_REQUEST_TIMEOUT_SECONDS']).toBe('150');
  });

  it('leaves the exec timeout to the provider default', async () => {
    const { sandbox, execCalls } = makeSandbox({
      mcpRequestTimeoutMs: 90_000,
      mcpConnectTimeoutMs: 30_000,
    });

    const call = await execAgentCommand(sandbox, execCalls);

    expect(call.env?.['TFY_NATS_REQUEST_TIMEOUT_SECONDS']).toBeUndefined();
    expect(call.timeoutSeconds).toBeUndefined();
  });
});
