/**
 * Configured-resource list helpers for composer pickers and host boot.
 * Not the settings catalog ports (`catalogs/*`).
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';

import type { ListResult, PageParams } from '../../server/types.js';
import { drainListPages } from '../../utils/drainListPages.js';
import { toListResult } from './chatServer.js';

export async function listModels(client: TrueForge): Promise<TrueForgeApi.AvailableModel[]> {
  const body = await client.models.list();
  return body.data;
}

export async function listConfiguredMcpServersPage(
  client: TrueForge,
  req: PageParams = {},
): Promise<ListResult<TrueForgeApi.AvailableMcpServer>> {
  const page = await client.mcpServers.list({
    ...(req.limit === undefined ? {} : { limit: req.limit }),
    ...(req.pageToken === undefined ? {} : { pageToken: req.pageToken }),
  });
  return toListResult(page, server => server);
}

/** Drain every MCP page (full catalog for non-picker callers). */
export async function listConfiguredMcpServers(client: TrueForge): Promise<TrueForgeApi.AvailableMcpServer[]> {
  return drainListPages({
    fetchPage: pageToken => listConfiguredMcpServersPage(client, { pageToken }),
  });
}

export async function listSkills(client: TrueForge): Promise<TrueForgeApi.AvailableSkill[]> {
  const body = await client.skills.list();
  return body.data;
}

export async function getCapabilities(client: TrueForge): Promise<TrueForgeApi.CapabilitiesData> {
  const body = await client.server.getCapabilities();
  return body.data;
}
