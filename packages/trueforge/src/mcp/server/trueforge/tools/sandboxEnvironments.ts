import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { z } from 'zod';
import { SandboxEnvironmentManifestRequestSchema } from '../../../../schemas/sandboxEnvironment';
import { isSdkRequestError, runTool, ToolResultError } from '../result';

/**
 * The HTTP API exposes a single create-or-update PUT. We split create and update over it and add a
 * preflight GET so intent is explicit (create fails if present; update fails if absent). Best-effort:
 * two concurrent creates can still race (no conditional-create at the API layer).
 */
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
      runTool(async () => {
        if (await environmentExists(client, manifest.name)) {
          throw new ToolResultError(409, `Sandbox environment already exists: ${manifest.name}`);
        }
        return client.sandboxEnvironments.createOrUpdate({ manifest } as unknown as Parameters<
          typeof client.sandboxEnvironments.createOrUpdate
        >[0]);
      }),
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
        return page.response;
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
    async ({ name }) => runTool(() => client.sandboxEnvironments.get(name)),
  );

  server.registerTool(
    'update_sandbox_environment',
    {
      description:
        'Change an existing sandbox environment — the resources, environment variables, networking, and build ' +
        'configuration agents run in — by replacing it with a complete manifest. The input name and manifest ' +
        'name must match, and this tool never creates a missing environment (use create_sandbox_environment for that). ' +
        'Never ask the user for a secret value and never send networking.secrets; keep any redacted secret ' +
        'placeholders returned by get_sandbox_environment. When the environment needs secrets, ask the user to ' +
        'create them in the sandbox environment settings.',
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
        return client.sandboxEnvironments.createOrUpdate({ manifest } as unknown as Parameters<
          typeof client.sandboxEnvironments.createOrUpdate
        >[0]);
      }),
  );
}
