/**
 * Harness ScheduleServer adapter — maps flat runtime DTOs to SDK wire (manifest + agentName).
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type {
  CreateScheduleRequest,
  CreateScheduleRunRequest,
  ListResult,
  ListSchedulesParams,
  Schedule,
  ScheduleRun,
  ScheduleServer,
  ScheduleStatus,
  UpdateScheduleRequest,
} from '../../../server/types.js';
import { toListResult } from '../chatServer.js';

/** Matches API PAGE_LIMIT for schedules list. */
const SCHEDULES_PAGE_LIMIT = 25;

type AgentIndex = {
  idToName: ReadonlyMap<string, string>;
  nameToId: ReadonlyMap<string, string>;
};

async function loadAgentIndex(client: TrueForge): Promise<AgentIndex> {
  const { data } = await client.agents.list();
  const idToName = new Map<string, string>();
  const nameToId = new Map<string, string>();
  for (const agent of data) {
    idToName.set(agent.id, agent.name);
    nameToId.set(agent.name, agent.id);
  }
  return { idToName, nameToId };
}

function resolveAgentName(agentId: string, index: AgentIndex): string {
  const byId = index.idToName.get(agentId);
  if (byId != null) return byId;
  if (index.nameToId.has(agentId)) return agentId;
  throw new Error(`Unknown agent: ${agentId}`);
}

function collectAgentIds(req?: ListSchedulesParams): string[] {
  const ids: string[] = [];
  if (req?.agentIds != null) {
    for (const id of req.agentIds) {
      if (id !== '') ids.push(id);
    }
  }
  if (req?.agentId != null && req.agentId !== '') ids.push(req.agentId);
  return [...new Set(ids)];
}

function wireStatus(manifest: TrueForgeApi.ScheduleManifest): ScheduleStatus {
  return manifest.status ?? 'active';
}

function toUiSchedule(wire: TrueForgeApi.Schedule, index: AgentIndex): Schedule {
  const agentId = index.nameToId.get(wire.agentName) ?? wire.agentName;
  return {
    id: wire.id,
    name: wire.name,
    agentId,
    agentName: wire.agentName,
    task: wire.manifest.task,
    cron: wire.manifest.cron,
    timezone: wire.manifest.timezone ?? 'UTC',
    status: wireStatus(wire.manifest),
    lastRunAt: null,
  };
}

function toWireManifest(input: {
  task: string;
  cron: string;
  timezone?: string;
  status?: ScheduleStatus;
}): TrueForgeApi.ScheduleManifest {
  return {
    task: input.task,
    cron: input.cron,
    timezone: input.timezone ?? 'UTC',
    status: input.status ?? 'active',
  };
}

function toIsoInstant(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function toUiScheduleRun(wire: TrueForgeApi.ScheduleRun): ScheduleRun {
  return {
    id: wire.id,
    scheduleId: wire.scheduleId,
    name: wire.name,
    scheduledFor: toIsoInstant(wire.scheduledFor),
    status: wire.status,
    triggeredAt: wire.triggeredAt == null ? null : toIsoInstant(wire.triggeredAt),
    triggeredBy: wire.triggeredBy,
  };
}

export function createScheduleServer(options: { client: TrueForge }): ScheduleServer {
  const { client } = options;

  return {
    async listSchedules(req?: ListSchedulesParams): Promise<ListResult<Schedule>> {
      const index = await loadAgentIndex(client);
      const agentIds = collectAgentIds(req);
      const agentNames = agentIds.length === 0 ? undefined : agentIds.map(id => resolveAgentName(id, index)).join(',');
      const limit = Math.min(Math.max(req?.limit ?? SCHEDULES_PAGE_LIMIT, 1), SCHEDULES_PAGE_LIMIT);
      const page = await client.schedules.list({
        limit,
        ...(req?.pageToken === undefined || req.pageToken === '' ? {} : { pageToken: req.pageToken }),
        ...(agentNames === undefined ? {} : { agentNames }),
      });
      return toListResult(page, row => toUiSchedule(row, index));
    },

    async getSchedule({ id }): Promise<Schedule> {
      const index = await loadAgentIndex(client);
      const { data } = await client.schedules.get(id);
      return toUiSchedule(data, index);
    },

    async createSchedule(req: CreateScheduleRequest): Promise<Schedule> {
      const index = await loadAgentIndex(client);
      const agentName = resolveAgentName(req.agentId, index);
      const { data } = await client.schedules.create({
        agentName,
        name: req.name,
        manifest: toWireManifest(req),
      });
      return toUiSchedule(data, index);
    },

    async updateSchedule(req: UpdateScheduleRequest): Promise<Schedule> {
      const index = await loadAgentIndex(client);
      const { data } = await client.schedules.update(req.id, {
        name: req.name,
        manifest: toWireManifest(req),
      });
      return toUiSchedule(data, index);
    },

    async deleteSchedule({ id }): Promise<void> {
      await client.schedules.delete(id);
    },

    async listScheduleRuns({ scheduleId }): Promise<ScheduleRun[]> {
      const { data } = await client.schedules.listRuns(scheduleId);
      return data.map(toUiScheduleRun);
    },

    async createScheduleRun(req: CreateScheduleRunRequest): Promise<ScheduleRun> {
      const { data } = await client.schedules.createRun({ scheduleId: req.scheduleId });
      return toUiScheduleRun(data);
    },
  };
}
