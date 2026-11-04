import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { TRUEFORGE_SESSION_HEADER } from '../../../../../../src/mcp/server/trueforge/headers';
import { registerAgentTools } from '../../../../../../src/mcp/server/trueforge/tools/agents';
import { registerSessionTools } from '../../../../../../src/mcp/server/trueforge/tools/sessions';

type ToolHandler = (input: Record<string, unknown>, extra?: Record<string, unknown>) => Promise<CallToolResult>;

describe('TrueForge MCP session tools', () => {
  it('uses an inline session spec as a lossless create_agent manifest', async () => {
    const handlers = new Map<string, ToolHandler>();
    const server = {
      registerTool: (name: string, _definition: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    } as unknown as McpServer;

    const session: TrueForgeApi.Session = {
      id: 'session-1',
      title: 'Support draft',
      agent: {
        type: 'inline',
        spec: {
          model: { name: 'openai/gpt-5' },
          mcpServers: [{ name: 'github' }, { name: 'trueforge' }],
          responseFormat: { type: 'json_object' },
          config: {
            iterationLimit: 42,
            sandbox: {
              enabled: true,
              fileDownloads: false,
              environmentName: 'development',
            },
          },
        },
      },
      createdAt: '2026-11-04T00:00:00.000Z',
      updatedAt: '2026-11-04T00:00:00.000Z',
      createdBySubject: {
        subjectId: 'user-1',
        subjectType: 'user',
        subjectDisplayName: 'Test User',
      },
      lastTurnDetails: null,
      metadata: {},
      metrics: { totalDurationMs: 0, totalTurns: 1 },
      shared: false,
      source: null,
    };

    const create = jest.fn().mockImplementation(async (request: TrueForgeApi.CreateAgentRequest) => ({
      data: {
        id: 'agent-1',
        name: request.name,
        description: request.description,
        manifest: request.manifest,
        createdBySubject: session.createdBySubject,
      },
    }));
    const client = {
      sessions: {
        get: jest.fn().mockResolvedValue({ data: session }),
      },
      agents: {
        create,
        get: jest.fn(),
        update: jest.fn(),
        list: jest.fn(),
      },
    } as unknown as TrueForge;
    registerSessionTools(server, client);
    registerAgentTools(server, client);

    const sessionResult = await handlers.get('get_current_session')?.(
      {},
      { requestInfo: { headers: { [TRUEFORGE_SESSION_HEADER]: session.id } } },
    );
    expect(sessionResult?.structuredContent).toMatchObject({
      data: {
        agent: {
          type: 'inline',
          spec: {
            mcp_servers: [{ name: 'github' }, { name: 'trueforge' }],
            response_format: { type: 'json_object' },
            config: {
              iteration_limit: 42,
              sandbox: {
                file_downloads: false,
                environment_name: 'development',
              },
            },
          },
        },
      },
    });

    const manifest = (
      sessionResult?.structuredContent as {
        data: { agent: { spec: Record<string, unknown> } };
      }
    ).data.agent.spec;
    await handlers.get('create_agent')?.({
      name: 'support-agent',
      description: 'Saved from draft',
      manifest,
    });

    expect(create).toHaveBeenCalledWith({
      name: 'support-agent',
      description: 'Saved from draft',
      manifest: expect.objectContaining({
        mcpServers: [expect.objectContaining({ name: 'github' })],
        responseFormat: { type: 'json_object' },
        config: expect.objectContaining({
          iterationLimit: 42,
          sandbox: expect.objectContaining({
            fileDownloads: false,
            environmentName: 'development',
          }),
        }),
      }),
    });
  });
});
