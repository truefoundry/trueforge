import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IsomorphicHeaders } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { SandboxEnvironmentManifestRequestSchema } from '../../../../schemas/sandboxEnvironment';
import { TRUEFORGE_SESSION_HEADER } from '../headers';
import type { McpToolDescriptor } from '../openApiTools';
import { ToolResultError, runTool } from '../result';
import { WireApiError, type WireApiClient } from '../wireApiClient';

function openApiTool(tools: readonly McpToolDescriptor[], name: string): McpToolDescriptor {
  const descriptor = tools.find(tool => tool.name === name);
  if (descriptor === undefined) {
    throw new Error(`OpenAPI tool ${name} is missing`);
  }
  return descriptor;
}

function headerValue(headers: IsomorphicHeaders | undefined, name: string): string | undefined {
  const raw = headers?.[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  return value === undefined || value.length === 0 ? undefined : value;
}

async function environmentExists(
  client: WireApiClient,
  name: string,
  getEnvironment: McpToolDescriptor,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    await client.execute(getEnvironment, { name }, signal);
    return true;
  } catch (error) {
    if (error instanceof WireApiError && error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

function registerCurrentSessionTool(server: McpServer, client: WireApiClient): void {
  const descriptor: McpToolDescriptor = {
    name: 'get_current_session',
    description:
      "Read this session's configuration: its title and inline agent spec, including the model, instructions, " +
      'MCP servers, skills, and sandbox configured here. This returns the configuration, not the message transcript.',
    annotations: { readOnlyHint: true },
    method: 'GET',
    path: '/api/v1/sessions/{session_id}',
    inputSchema: {},
    pathParameters: ['session_id'],
    queryParameters: [],
    bodyParameters: [],
  };
  server.registerTool(
    descriptor.name,
    {
      description: descriptor.description,
      inputSchema: {},
      annotations: descriptor.annotations,
    },
    async (_args, extra) =>
      runTool(async () => {
        const sessionId = headerValue(extra.requestInfo?.headers, TRUEFORGE_SESSION_HEADER);
        if (sessionId === undefined) {
          throw new ToolResultError(400, 'No current chat. This tool is only available during a draft session turn.');
        }
        return client.execute(descriptor, { session_id: sessionId }, extra.signal);
      }),
  );
}

function registerSandboxEnvironmentUpdateTool(
  server: McpServer,
  client: WireApiClient,
  tools: readonly McpToolDescriptor[],
): void {
  const getEnvironment = openApiTool(tools, 'get_sandbox_environment');
  const descriptor: McpToolDescriptor = {
    name: 'update_sandbox_environment',
    description:
      'Replace an existing sandbox environment; the input and manifest names must match. Call ' +
      'get_sandbox_environment first and return networking.secrets unchanged, including redacted placeholders. ' +
      'Never request or submit secret values; ask the user to manage secrets in settings.',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    method: 'PUT',
    path: '/api/v1/sandbox-environments',
    inputSchema: {},
    pathParameters: [],
    queryParameters: [],
    bodyParameters: ['manifest'],
  };
  server.registerTool(
    descriptor.name,
    {
      description: descriptor.description,
      inputSchema: { name: z.string(), manifest: SandboxEnvironmentManifestRequestSchema },
      annotations: descriptor.annotations,
    },
    async ({ name, manifest }, extra) =>
      runTool(async () => {
        if (name !== manifest.name) {
          throw new ToolResultError(400, 'input name and manifest.name must match');
        }
        if (!(await environmentExists(client, name, getEnvironment, extra.signal))) {
          throw new ToolResultError(404, `Sandbox environment not found: ${name}`);
        }
        return client.execute(descriptor, { manifest }, extra.signal);
      }),
  );
}

/** Register tools whose contracts intentionally add semantics beyond one public OpenAPI operation. */
export function registerCustomTools(
  server: McpServer,
  client: WireApiClient,
  tools: readonly McpToolDescriptor[],
): void {
  registerCurrentSessionTool(server, client);
  registerSandboxEnvironmentUpdateTool(server, client, tools);
}
