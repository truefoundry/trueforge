import type { MCPServerInitInfo, ToolApprovalPolicyAction } from '../../../src/core/events/schema';
import { EventType } from '../../../src/core/events/schema';
import type { AgentToolSchema, IToolSet, ListToolsResponse } from '../../../src/core/mcp/IMCPServer';
import { convertMCPServersToTools } from '../../../src/core/mcp/convertMCPServers';
import '../harnessMocks';
import { OBJECT_INPUT_SCHEMA, makeMockIMCPServer } from '../harnessMocks';

function makeServer(params: {
  name: string;
  initInfo?: MCPServerInitInfo;
  tools?: AgentToolSchema[] | undefined;
  approvalPolicies?: Record<string, ToolApprovalPolicyAction>;
}): IToolSet {
  const base = makeMockIMCPServer({
    name: params.name,
    preload: true,
    tools: params.tools,
  });
  return {
    ...base,
    ...(params.approvalPolicies ? { getApprovalPolicies: jest.fn(() => params.approvalPolicies ?? {}) } : {}),
    listTools: jest.fn((): Promise<ListToolsResponse> =>
      Promise.resolve({
        result: {
          tools: params.tools ?? [
            { name: 'do_thing', description: 'Does a thing', inputSchema: OBJECT_INPUT_SCHEMA, preload: true },
          ],
        },
        wasInitialized: params.initInfo,
      }),
    ),
  };
}

describe('convertMCPServersToTools initialization aggregation', () => {
  it('aggregates wasInitialized info from each server into initializationInfo', async () => {
    const alphaInit: MCPServerInitInfo = {
      id: 'alpha-id',
      name: 'alpha',
      session_id: 'sess-alpha',
    };
    const betaInit: MCPServerInitInfo = {
      id: 'beta-id',
      name: 'beta',
      session_id: 'sess-beta',
    };

    const { initializationInfo, convertedTools } = await convertMCPServersToTools({
      tfyManagedServers: [makeServer({ name: 'alpha', initInfo: alphaInit })],
      userServers: [makeServer({ name: 'beta', initInfo: betaInit })],
    });

    expect(initializationInfo).toEqual([alphaInit, betaInit]);
    expect(convertedTools.tools.length).toBe(2);
  });

  it('carries the tool set approval policies onto its init info', async () => {
    const withPoliciesInit: MCPServerInitInfo = {
      id: 'with-policies',
      name: 'with-policies',
      session_id: 'sess-with-policies',
    };
    const policies: Record<string, ToolApprovalPolicyAction> = {
      write_note: { type: 'allow_session' },
      delete_note: { type: 'allow_session', expire_at: '2999-01-01T00:00:00.000Z' },
    };
    const bareInit: MCPServerInitInfo = { id: 'bare', name: 'bare', session_id: 'sess-bare' };

    const { initializationInfo } = await convertMCPServersToTools({
      tfyManagedServers: [],
      userServers: [
        makeServer({ name: 'with-policies', initInfo: withPoliciesInit, approvalPolicies: policies }),
        makeServer({ name: 'bare', initInfo: bareInit }),
      ],
    });

    expect(initializationInfo).toEqual([bareInit, { ...withPoliciesInit, approval_policies: policies }]);
  });

  it('skips initialization entries for OAuth-required servers', async () => {
    const oauthServer: IToolSet = {
      name: 'oauth-server',
      id: 'oauth-server',
      preload: true,
      hasPreloadedTools: true,
      listTools: jest.fn(() =>
        Promise.resolve({
          authRequired: {
            servers: [{ id: 'oauth-server', name: 'oauth-server', auth_url: 'https://auth.example' }],
          },
        }),
      ),
      callTool: jest.fn(),
      toolCallInfo: jest.fn(),
      setApprovalPolicy: jest.fn(),
      getApprovalPolicies: jest.fn(() => ({})),
    };

    const readyInit: MCPServerInitInfo = {
      id: 'ready-id',
      name: 'ready',
      session_id: 'sess-ready',
    };
    const { initializationInfo, authRequirementInfo } = await convertMCPServersToTools({
      tfyManagedServers: [makeServer({ name: 'ready', initInfo: readyInit })],
      userServers: [oauthServer],
    });

    expect(initializationInfo).toEqual([readyInit]);
    expect(authRequirementInfo).toHaveLength(1);
  });

  it('matches mcp.initialize event shape when init info is wrapped', () => {
    const initInfo: MCPServerInitInfo[] = [{ id: 'srv-1', name: 'srv-1', session_id: 'abc' }];
    const event = {
      type: EventType.MCP_INITIALIZE,
      thread_id: 'thread-1',
      mcp_servers: initInfo,
    };
    expect(event.type).toBe('mcp.initialize');
    expect(event.mcp_servers).toEqual(initInfo);
  });
});
