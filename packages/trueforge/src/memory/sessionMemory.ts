import type { SessionRecord } from '@truefoundry/trueforge-core/agent-session';
import { memory, type AgentCapability, type AgentTracing, type ScopedMemory } from '@truefoundry/trueforge-core/core';
import type { Logger } from 'winston';
import type { IAgentStore } from '../db/agentStore';
import type { ConfiguredMemory } from './memoryFromConfig';
import { resolveMemoryScope, type MemoryScope } from './scope';

/** Session start waits at most this long for the user summary, then continues without it. */
export const MEMORY_SUMMARY_TIMEOUT_MS = 2_000;

export type SessionMemoryCapability = (input: { tracing: AgentTracing }) => AgentCapability;

/**
 * Memory for one turn of a session, or undefined when memory doesn't apply: off for the deployment
 * or tenant, a scheduled session, an agent whose spec has memory off, or a non-UI session without an
 * agent. The scope comes from the session (tenant, agent, creator), never from model input, so the
 * tools reach exactly the memory ingestion writes to.
 *
 * The summary is fetched only on the session's first turn; later turns render the copy persisted in
 * capability state, so Zep isn't called again for it.
 */
export async function resolveSessionMemory({
  sessionId,
  tenantId,
  record,
  memory: configured,
  agentStore,
  logger,
  summaryTimeoutMs = MEMORY_SUMMARY_TIMEOUT_MS,
}: {
  sessionId: string;
  tenantId: string;
  record: Pick<SessionRecord, 'agent' | 'created_by_subject' | 'metadata' | 'source' | 'last_turn_details'>;
  memory: ConfiguredMemory | undefined;
  agentStore: Pick<IAgentStore, 'getAgent'>;
  logger: Logger;
  summaryTimeoutMs?: number;
}): Promise<SessionMemoryCapability | undefined> {
  if (configured === undefined || record.source !== null) {
    return undefined;
  }
  const { provider, settings } = configured;
  let scope: MemoryScope;
  try {
    if (!(await settings.isTenantMemoryEnabled(tenantId))) {
      return undefined;
    }
    const agentId = record.agent.type === 'reference' ? record.agent.id : null;
    const agentMemoryEnabled =
      agentId === null
        ? false
        : ((await agentStore.getAgent({ tenant_id: tenantId, id: agentId }))?.manifest.config.memory.enabled ?? false);
    const resolution = resolveMemoryScope({
      tenantId,
      createdBySubject: record.created_by_subject,
      agentId,
      agentMemoryEnabled,
      tfgSource: record.metadata['tfg.source'] ?? null,
    });
    if (!resolution.eligible) {
      return undefined;
    }
    scope = resolution.scope;
  } catch (error) {
    logger.warn('Memory unavailable for this turn', { error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }

  const sessionStartSummary =
    record.last_turn_details === null
      ? { summary: await loadSummary({ provider: configured.provider, scope, timeoutMs: summaryTimeoutMs, logger }) }
      : undefined;

  const scoped: ScopedMemory = {
    search: ({ query, limit }) => provider.search({ scope, query, limit }),
    add: ({ content }) => provider.addMemory({ scope, content, sessionId, createdAt: new Date().toISOString() }),
  };
  return ({ tracing }) => memory({ memory: scoped, sessionStartSummary, tracing });
}

/** Single bounded attempt; any failure means "no summary" so the turn starts on time. */
async function loadSummary({
  provider,
  scope,
  timeoutMs,
  logger,
}: {
  provider: ConfiguredMemory['provider'];
  scope: MemoryScope;
  timeoutMs: number;
  logger: Logger;
}): Promise<string | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    const summary = await provider.getUserSummary({ scope, signal: controller.signal });
    logger.info('Memory summary loaded', { scope_type: scope.type, summary_chars: summary?.length ?? 0 });
    return summary;
  } catch (error) {
    logger.warn('Memory summary unavailable; starting the session without it', {
      scope_type: scope.type,
      timed_out: controller.signal.aborted,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
