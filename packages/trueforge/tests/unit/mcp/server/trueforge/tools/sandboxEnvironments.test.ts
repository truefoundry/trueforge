import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { registerSandboxEnvironmentTools } from '../../../../../../src/mcp/server/trueforge/tools/sandboxEnvironments';

type ToolHandler = (input: Record<string, unknown>) => Promise<CallToolResult>;

const environment: TrueForgeApi.SandboxEnvironment = {
  id: 'environment-1',
  name: 'development',
  description: 'Development environment',
  lifecycleStage: 'active',
  status: 'ready',
  statusReason: null,
  manifest: {
    name: 'development',
    description: 'Development environment',
    image: { type: 'build', buildScript: 'pip install httpx' },
    resources: { cpu: 2, memory: 4, disk: 8 },
    environmentVariables: { LOG_LEVEL: 'debug' },
    networking: {
      networkBlockAll: false,
      domainAllowList: 'api.example.com',
      secrets: [{ env: 'API_TOKEN', value: '********', hosts: ['api.example.com'] }],
    },
  },
  createdBySubject: {
    subjectId: 'user-1',
    subjectType: 'user',
    subjectDisplayName: 'Test User',
  },
  createdAt: new Date('2026-11-04T00:00:00.000Z'),
  updatedAt: new Date('2026-11-04T00:00:00.000Z'),
};

describe('TrueForge MCP sandbox environment tools', () => {
  it('round-trips get output through update without losing renamed fields or redacted secrets', async () => {
    const handlers = new Map<string, ToolHandler>();
    const server = {
      registerTool: (name: string, _definition: unknown, handler: ToolHandler) => {
        handlers.set(name, handler);
      },
    } as unknown as McpServer;

    const get = jest.fn().mockResolvedValue({ data: environment });
    const createOrUpdate = jest
      .fn()
      .mockImplementation(async (request: TrueForgeApi.UpdateSandboxEnvironmentRequest) => ({
        data: { ...environment, manifest: request.manifest },
      }));
    const client = {
      sandboxEnvironments: {
        get,
        createOrUpdate,
        list: jest.fn(),
      },
    } as unknown as TrueForge;
    registerSandboxEnvironmentTools(server, client);

    const getResult = await handlers.get('get_sandbox_environment')?.({ name: environment.name });
    expect(getResult?.structuredContent).toMatchObject({
      data: {
        manifest: {
          image: { type: 'build', build_script: 'pip install httpx' },
          environment_variables: { LOG_LEVEL: 'debug' },
          networking: {
            network_block_all: false,
            domain_allow_list: 'api.example.com',
            secrets: [{ env: 'API_TOKEN', value: '********', hosts: ['api.example.com'] }],
          },
        },
      },
    });

    const manifest = (getResult?.structuredContent as { data: { manifest: Record<string, unknown> } }).data.manifest;
    await handlers.get('update_sandbox_environment')?.({
      name: environment.name,
      manifest,
    });

    expect(createOrUpdate).toHaveBeenCalledWith({
      manifest: expect.objectContaining({
        name: 'development',
        image: { type: 'build', buildScript: 'pip install httpx' },
        environmentVariables: { LOG_LEVEL: 'debug' },
        networking: {
          networkBlockAll: false,
          domainAllowList: 'api.example.com',
          secrets: [{ env: 'API_TOKEN', value: '********', hosts: ['api.example.com'] }],
        },
      }),
    });
  });
});
