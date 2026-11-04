import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { serialization, type TrueForge, type TrueForgeApi } from '@truefoundry/trueforge-sdk';
import { z } from 'zod';
import { SandboxEnvironmentManifestRequestSchema } from '../../../../schemas/sandboxEnvironment';
import { isSdkRequestError, runTool, ToolResultError } from '../result';

type SandboxEnvironmentManifestInput = z.infer<typeof SandboxEnvironmentManifestRequestSchema>;

/** MCP tools use the HTTP wire shape; the generated SDK uses camelCase objects. */
function manifestForSdk(manifest: SandboxEnvironmentManifestInput): TrueForgeApi.SandboxEnvironmentManifestRequest {
  return serialization.SandboxEnvironmentManifestRequest.parseOrThrow(manifest, {
    unrecognizedObjectKeys: 'fail',
  });
}

/** Keep read and mutation results in the snake_case shape accepted by mutation tools. */
function environmentResponseForTool(
  response: TrueForgeApi.GetSandboxEnvironmentResponse,
): serialization.GetSandboxEnvironmentResponse.Raw {
  return serialization.GetSandboxEnvironmentResponse.jsonOrThrow(response, {
    unrecognizedObjectKeys: 'passthrough',
    allowUnrecognizedUnionMembers: true,
    allowUnrecognizedEnumValues: true,
    omitUndefined: true,
  });
}

function environmentListResponseForTool(
  response: TrueForgeApi.ListSandboxEnvironmentsResponse,
): serialization.ListSandboxEnvironmentsResponse.Raw {
  return serialization.ListSandboxEnvironmentsResponse.jsonOrThrow(response, {
    unrecognizedObjectKeys: 'passthrough',
    allowUnrecognizedUnionMembers: true,
    allowUnrecognizedEnumValues: true,
    omitUndefined: true,
  });
}

async function environmentExists(client: TrueForge, name: string): Promise<boolean> {
  try {
    await client.sandboxEnvironments.get(name);
    return true;
  } catch (error) {
    if (isSdkRequestError(error) && error.statusCode === 404) {
      return false;
    }
    throw error;
  }
}

export function registerSandboxEnvironmentTools(server: McpServer, client: TrueForge): void {
  server.registerTool(
    'create_sandbox_environment',
    {
      description:
        'Create a reusable sandbox environment that agents run in — defining its resources, environment ' +
        'variables, networking, and build configuration — from a complete manifest. Fails if an environment ' +
        'with the same name already exists; the reserved `default` environment cannot be created. ' +
        'Never ask the user for a secret value and never send networking.secrets. When the environment needs ' +
        'secrets, ask the user to create them in the sandbox environment settings.',
      inputSchema: { manifest: SandboxEnvironmentManifestRequestSchema },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ manifest }) =>
      runTool(() =>
        client.sandboxEnvironments.create({ manifest: manifestForSdk(manifest) }).then(environmentResponseForTool),
      ),
  );

  server.registerTool(
    'list_sandbox_environments',
    {
      description:
        'Discover existing sandbox environments you can reference from an agent, or find one to update. ' +
        'Returns one paginated page. Secret values are redacted; never ask the user for them. When an ' +
        'environment needs secrets, ask the user to create them in the sandbox environment settings.',
      inputSchema: {
        page_size: z.number().int().positive().optional(),
        page_token: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ page_size, page_token }) =>
      runTool(async () => {
        const page = await client.sandboxEnvironments.list({
          limit: page_size,
          pageToken: page_token,
        } as Parameters<typeof client.sandboxEnvironments.list>[0]);
        return environmentListResponseForTool(page.response);
      }),
  );

  server.registerTool(
    'get_sandbox_environment',
    {
      description:
        'Fetch one sandbox environment by name — its manifest, build status, resources, environment ' +
        'variables, and networking configuration. Use it to review an environment or get a template before updating it. ' +
        'Secret values are redacted; never ask the user for them. When the environment needs secrets, ask the user ' +
        'to create them in the sandbox environment settings.',
      inputSchema: { name: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ name }) => runTool(async () => environmentResponseForTool(await client.sandboxEnvironments.get(name))),
  );

  server.registerTool(
    'update_sandbox_environment',
    {
      description:
        'Change an existing sandbox environment — the resources, environment variables, networking, and build ' +
        'configuration agents run in — by replacing it with a complete manifest. The input name and manifest ' +
        'name must match, and this tool never creates a missing environment (use create_sandbox_environment for that). ' +
        'Never ask the user for a secret value. Call get_sandbox_environment first and send its networking.secrets ' +
        'back unchanged, including the redacted placeholders. ' +
        'Never replace a placeholder with a real secret value. When the environment needs new secrets, ask the user ' +
        'to create them in the sandbox environment settings.',
      inputSchema: { name: z.string(), manifest: SandboxEnvironmentManifestRequestSchema },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ name, manifest }) =>
      runTool(async () => {
        if (name !== manifest.name) {
          throw new ToolResultError(400, 'input name and manifest.name must match');
        }
        if (!(await environmentExists(client, name))) {
          throw new ToolResultError(404, `Sandbox environment not found: ${name}`);
        }
        return client.sandboxEnvironments
          .createOrUpdate({ manifest: manifestForSdk(manifest) })
          .then(environmentResponseForTool);
      }),
  );
}
