import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { registerAgentTools } from '../../../../../../src/mcp/server/trueforge/tools/agents';

type ToolHandler = (input: Record<string, unknown>) => Promise<CallToolResult>;

const sdkAgent: TrueForgeApi.Agent = {
  id: 'agent-1',
  name: 'support-agent',
  description: 'Support agent',
  createdBySubject: {
    subjectId: 'user-1',
    subjectType: 'user',
    subjectDisplayName: 'Test User',
  },
  manifest: {
    model: { name: 'openai/gpt-5' },
    mcpServers: [
      {
        name: 'github',
        enableTools: ['@read-only'],
        preloadTools: ['search'],
        requireApprovalForTools: ['@write'],
      },
    ],
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
};

describe('TrueForge MCP agent tools', () => {
  it('round-trips get_agent output through update_agent without losing renamed fields', async () => {
    const handlers = new Map<string, ToolHandler>();
    const server = {
      registerTool: (name: string, _definition: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    } as unknown as McpServer;

    const get = jest.fn().mockResolvedValue({ data: sdkAgent });
    const update = jest.fn().mockImplementation(async (_id: string, request: TrueForgeApi.UpdateAgentRequest) => ({
      data: { ...sdkAgent, description: request.description ?? sdkAgent.description, manifest: request.manifest },
    }));
    const client = {
      agents: {
        get,
        update,
        create: jest.fn(),
        list: jest.fn(),
      },
    } as unknown as TrueForge;
    registerAgentTools(server, client);

    const getResult = await handlers.get('get_agent')?.({ agent_id: sdkAgent.id });
    expect(getResult?.structuredContent).toMatchObject({
      data: {
        manifest: {
          mcp_servers: [
            {
              name: 'github',
              enable_tools: ['@read-only'],
              preload_tools: ['search'],
              require_approval_for_tools: ['@write'],
            },
          ],
          response_format: { type: 'json_object' },
          config: {
            iteration_limit: 42,
            sandbox: {
              enabled: true,
              file_downloads: false,
              environment_name: 'development',
            },
          },
        },
      },
    });

    const wireManifest = (getResult?.structuredContent as { data: { manifest: Record<string, unknown> } }).data
      .manifest;
    const updateResult = await handlers.get('update_agent')?.({
      agent_id: sdkAgent.id,
      description: 'Updated support agent',
      manifest: wireManifest,
    });

    expect(update).toHaveBeenCalledWith(sdkAgent.id, {
      description: 'Updated support agent',
      manifest: expect.objectContaining({
        mcpServers: [
          expect.objectContaining({
            name: 'github',
            enableTools: ['@read-only'],
            preloadTools: ['search'],
            requireApprovalForTools: ['@write'],
          }),
        ],
        responseFormat: { type: 'json_object' },
        config: expect.objectContaining({
          iterationLimit: 42,
          sandbox: expect.objectContaining({
            enabled: true,
            fileDownloads: false,
            environmentName: 'development',
          }),
        }),
      }),
    });
    expect(updateResult?.structuredContent).toMatchObject({
      data: {
        manifest: {
          mcp_servers: [{ name: 'github' }],
          response_format: { type: 'json_object' },
          config: { iteration_limit: 42 },
        },
      },
    });
  });
});
