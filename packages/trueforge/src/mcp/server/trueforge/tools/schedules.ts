import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { TrueForge } from '@truefoundry/trueforge-sdk';
import { z } from 'zod';
import { ScheduleManifestSchema } from '../../../../schemas/schedule';
import { runTool } from '../result';

export function registerScheduleTools(server: McpServer, client: TrueForge): void {
  server.registerTool(
    'create_schedule',
    {
      description:
        'Make an existing named agent run automatically on a recurring basis — for example a daily summary ' +
        '— by binding it to a task and a cron schedule. Timezone defaults to UTC and status to active.',
      inputSchema: {
        agent_name: z.string(),
        name: z.string(),
        manifest: ScheduleManifestSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    },
    async ({ agent_name, name, manifest }) =>
      runTool(() =>
        client.schedules.create({ agentName: agent_name, name, manifest } as Parameters<
          typeof client.schedules.create
        >[0]),
      ),
  );

  server.registerTool(
    'list_schedules',
    {
      description:
        'Discover existing schedules — for example to see what an agent already runs on a timer, or to find ' +
        'one to update. Supports optional filters and returns one paginated page.',
      inputSchema: {
        agent_names: z.array(z.string()).optional(),
        created_by_me: z.boolean().optional(),
        page_size: z.number().int().positive().optional(),
        page_token: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ agent_names, created_by_me, page_size, page_token }) =>
      runTool(async () => {
        const page = await client.schedules.list({
          limit: page_size,
          pageToken: page_token,
          agentNames: agent_names?.join(','),
          createdByMe: created_by_me,
        } as Parameters<typeof client.schedules.list>[0]);
        return page.response;
      }),
  );

  server.registerTool(
    'get_schedule',
    {
      description:
        "Fetch one schedule's full configuration by its immutable ID — its bound agent, task, cron " +
        'expression, timezone, and status. Use it to review a schedule or get a template before updating it.',
      inputSchema: { schedule_id: z.string() },
      annotations: { readOnlyHint: true },
    },
    async ({ schedule_id }) => runTool(() => client.schedules.get(schedule_id)),
  );

  server.registerTool(
    'list_schedule_runs',
    {
      description:
        "Check a schedule's execution history to see whether its runs are succeeding or why they failed. " +
        'Each run includes its status, scheduled and triggered times, and any failure reason. Returns one paginated page.',
      inputSchema: {
        schedule_id: z.string(),
        page_size: z.number().int().positive().optional(),
        page_token: z.string().optional(),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ schedule_id, page_size, page_token }) =>
      runTool(async () => {
        const page = await client.schedules.listRuns(schedule_id, {
          limit: page_size,
          pageToken: page_token,
        } as Parameters<typeof client.schedules.listRuns>[1]);
        return page.response;
      }),
  );

  server.registerTool(
    'update_schedule',
    {
      description:
        'Change an existing schedule — for example its task, cadence, or active/paused state — by replacing ' +
        'its name and complete manifest by immutable ID. The bound agent cannot change, and because this is a ' +
        'full replacement, omitted optional fields return to their defaults.',
      inputSchema: {
        schedule_id: z.string(),
        name: z.string(),
        manifest: ScheduleManifestSchema,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true },
    },
    async ({ schedule_id, name, manifest }) =>
      runTool(() =>
        client.schedules.update(schedule_id, { name, manifest } as Parameters<typeof client.schedules.update>[1]),
      ),
  );
}
