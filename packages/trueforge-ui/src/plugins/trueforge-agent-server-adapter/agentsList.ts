/**
 * Paginated helpers for `client.agents.list` (API default 50, max 100).
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';

/** Matches API AGENTS_PAGE_DEFAULT / AGENTS_PAGE_LIMIT. */
export const AGENTS_PAGE_DEFAULT = 50;
export const AGENTS_PAGE_LIMIT = 100;

export function clampAgentsPageSize(size: number): number {
  return Math.min(Math.max(size, 1), AGENTS_PAGE_LIMIT);
}

/**
 * One page of agents. `offset` must be a multiple of `limit` (page-aligned);
 * advances via SDK `getNextPage` so we never invent page tokens.
 */
export async function listAgentsPage({
  client,
  limit,
  offset = 0,
  agentName,
}: {
  client: TrueForge;
  limit: number;
  offset?: number;
  agentName?: string;
}): Promise<TrueForgeApi.Agent[]> {
  const pageSize = clampAgentsPageSize(limit);
  const start = Math.max(0, offset);
  const page = await client.agents.list({
    limit: pageSize,
    ...(agentName === undefined ? {} : { agentName }),
  });
  let at = 0;
  while (at < start) {
    if (!page.hasNextPage()) return [];
    await page.getNextPage();
    at += pageSize;
  }
  return [...page.data];
}

/** Drain every agents page into one array (name lookups, indexes). */
export async function drainAgentsList(client: TrueForge): Promise<TrueForgeApi.Agent[]> {
  const items: TrueForgeApi.Agent[] = [];
  const page = await client.agents.list({ limit: AGENTS_PAGE_DEFAULT });
  for (;;) {
    items.push(...page.data);
    if (!page.hasNextPage()) break;
    await page.getNextPage();
  }
  return items;
}
