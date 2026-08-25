import type { CodeModeTransport } from '../../../src/core/sandbox/codeMode/CodeModeTransport';
import type { ExecResult, SandboxExecParams, SandboxProvider } from '../../../src/core/sandbox/provider/Provider';
import { Sandbox, SANDBOX_EXEC_TOOL_NAME } from '../../../src/core/sandbox/Sandbox';
import { NOOP_AGENT_TRACING } from '../../../src/core/tracing/NoopAgentTracing';
import { makeMockIMCPServer, makeSilentLogger } from '../harnessMocks';

const AGENT_COMMAND = 'echo hello';

function makeSandbox(options: {
  mcpRequestTimeoutMs: number;
  mcpConnectTimeoutMs: number;
  transport?: CodeModeTransport;
}): {
  sandbox: Sandbox;
  execCalls: SandboxExecParams[];
} {
  const execCalls: SandboxExecParams[] = [];
  const transport = options.transport;
  const provider: SandboxProvider = {
    type: 'test',
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
    getFileUploadsDir: () => '/tmp/uploads',
    getSkillsDir: () => '/opt/tfy/skills',
    getGitDownloaderPath: () => '/opt/tfy/git_downloader.py',
    downloadFile: jest.fn(),
    uploadFile: jest.fn(),
    createCodeModeTransport: () => {
      if (transport === undefined) {
        throw new Error('createCodeModeTransport should not be called without a mock transport');
      }
      return transport;
    },
  };
  return {
    sandbox: new Sandbox({
      provider,
      blockDestructiveToolsInCodeMode: true,
      mcpRequestTimeoutMs: options.mcpRequestTimeoutMs,
      mcpConnectTimeoutMs: options.mcpConnectTimeoutMs,
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
  it('derives the Code Mode wait from MCP request + connect plus a buffer', async () => {
    let capturedTimeoutSeconds: number | undefined;
    const transport: CodeModeTransport = {
      getClientInstall: () => ({
        content: '#!/usr/bin/env python3\nprint("mock")\n',
        remotePath: '/opt/tfy/mcp-client/mcp_client.py',
        pathBinSymlink: '/usr/local/bin/mcp-client',
      }),
      start: params => {
        capturedTimeoutSeconds = params.requestTimeoutSeconds;
        return Promise.resolve({
          env: {
            TFY_NATS_URL: 'ws://localhost:4223',
            TFY_NATS_SUBJECT_PREFIX: 'sandbox.bridge.test',
            TFY_CM_REQUEST_TIMEOUT_SECONDS: String(params.requestTimeoutSeconds),
          },
        });
      },
      stop: () => Promise.resolve(),
    };
    const { sandbox, execCalls } = makeSandbox({
      mcpRequestTimeoutMs: 90_000,
      mcpConnectTimeoutMs: 30_000,
      transport,
    });
    sandbox.configureCodeMode([makeMockIMCPServer({ name: 'github', preload: true })]);

    const call = await execAgentCommand(sandbox, execCalls);

    expect(capturedTimeoutSeconds).toBe(150);
    expect(call.env?.['TFY_CM_REQUEST_TIMEOUT_SECONDS']).toBe('150');
    expect(call.env?.['PATH']).toBeUndefined();
    expect(call.env?.['PYTHONPATH']).toBe('/opt/tfy/mcp-client');
    const init = execCalls.find(item => item.command.includes('ln -sf'));
    expect(init?.command).toContain('/usr/local/bin/mcp-client');
    expect(init?.command).not.toContain('/opt/tfy/mcp-client/bin/mcp-client');
  });

  it('leaves the exec timeout to the provider default', async () => {
    const { sandbox, execCalls } = makeSandbox({
      mcpRequestTimeoutMs: 90_000,
      mcpConnectTimeoutMs: 30_000,
    });

    const call = await execAgentCommand(sandbox, execCalls);

    expect(call.env?.['TFY_CM_REQUEST_TIMEOUT_SECONDS']).toBeUndefined();
    expect(call.timeoutSeconds).toBeUndefined();
  });
});
