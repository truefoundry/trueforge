/**
 * Paginated helpers for `client.agents.list` (API default 50, max 100).
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';

import type { ListResult } from '../../server/types.js';
import { toListResult } from './chatServer.js';

/** Matches API AGENTS_PAGE_DEFAULT / AGENTS_PAGE_LIMIT. */
export const AGENTS_PAGE_DEFAULT = 50;
export const AGENTS_PAGE_LIMIT = 100;

export function clampAgentsPageSize(size: number): number {
  return Math.min(Math.max(size, 1), AGENTS_PAGE_LIMIT);
}

/** One page of agents, with API next/previous page tokens. */
export async function listAgentsPage({
  client,
  limit,
  pageToken,
  agentName,
}: {
  client: TrueForge;
  limit: number;
  pageToken?: string;
  agentName?: string;
}): Promise<ListResult<TrueForgeApi.Agent>> {
  const pageSize = clampAgentsPageSize(limit);
  const page = await client.agents.list({
    limit: pageSize,
    ...(pageToken === undefined || pageToken === '' ? {} : { pageToken }),
    ...(agentName === undefined ? {} : { agentName }),
  });
  return toListResult(page, agent => agent);
}

/** Drain every agents page into one array (name lookups, indexes). */
export async function drainAgentsList(client: TrueForge): Promise<TrueForgeApi.Agent[]> {
  const items: TrueForgeApi.Agent[] = [];
  let pageToken: string | undefined;
  for (;;) {
    const page = await listAgentsPage({
      client,
      limit: AGENTS_PAGE_DEFAULT,
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    items.push(...page.data);
    if (page.nextPageToken == null || page.nextPageToken === '') break;
    pageToken = page.nextPageToken;
  }
  return items;
}
