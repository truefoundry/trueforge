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

function makeSandbox(options?: { natsRequestTimeoutSeconds?: number; execTimeoutSeconds?: number }): {
  sandbox: Sandbox;
  execCalls: SandboxExecParams[];
} {
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

  it('uses independently configured NATS and exec timeouts when MCP is available', async () => {
    const { sandbox, execCalls } = makeSandbox({
      natsRequestTimeoutSeconds: 120,
      execTimeoutSeconds: 900,
    });
    sandbox.configureCodeMode([makeMockIMCPServer({ name: 'github', preload: true })]);

    const call = await execAgentCommand(sandbox, execCalls);

    expect(call.env?.['TFY_NATS_REQUEST_TIMEOUT_SECONDS']).toBe('120');
    expect(call.timeoutSeconds).toBe(900);
  });

  it('uses the configured exec timeout when MCP is unavailable', async () => {
    const { sandbox, execCalls } = makeSandbox({ execTimeoutSeconds: 900 });

    const call = await execAgentCommand(sandbox, execCalls);

    expect(call.env?.['TFY_NATS_REQUEST_TIMEOUT_SECONDS']).toBeUndefined();
    expect(call.timeoutSeconds).toBe(900);
  });
});
