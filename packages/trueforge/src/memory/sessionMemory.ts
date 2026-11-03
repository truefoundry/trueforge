import type { SessionRecord } from '@truefoundry/trueforge-core/agent-session';
import { memory, type AgentCapability, type ScopedMemory } from '@truefoundry/trueforge-core/core';
import { estimateTokensForString } from '@truefoundry/trueforge-core/core/llm/usage';
import type { Logger } from 'winston';
import type { IAgentStore } from '../db/agentStore';
import type { ConfiguredMemory } from './memoryFromConfig';
import { isTenantMemoryEnabled } from './MemorySettings';
import { CREATE_AGENT_SESSION_METADATA_KEY, resolveMemoryScope, type MemoryScope } from './scope';

/** Session start waits at most this long for the user summary, then continues without it. */
export const MEMORY_SUMMARY_TIMEOUT_MS = 2_000;
/** The session-start summary is cut to fit this budget, at a sentence or line end where one fits. */
export const MEMORY_SUMMARY_MAX_TOKENS = 1_000;

const INTERNAL_TAG = /<\s*(\/?)\s*tfy-internal\s*>/gi;
const SENTENCE_ENDS = /[.!?](?=\s)|\n/g;
const WORD_ENDS = /\S(?=\s)/g;
/** Grapheme clusters, so a cut never splits an emoji (skin tones, flags, ZWJ sequences). */
const graphemeSegmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Memory for one turn of a session, or undefined when memory doesn't apply: off for the deployment
 * or tenant, a scheduled session, an agent whose spec has memory off, or a non-UI session without an
 * agent. The scope comes from the session (tenant, agent, creator), never from model input, so the
 * tools reach exactly the memory ingestion writes to.
 *
 * The summary is fetched only on the session's first turn and loaded into its context; later turns
 * replay it from there, so the memory provider isn't called again for it.
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
}): Promise<AgentCapability | undefined> {
  if (configured === undefined || record.source !== null) {
    return undefined;
  }
  const { provider, settings } = configured;
  let scope: MemoryScope;
  try {
    const tenantAllows = await isTenantMemoryEnabled(settings, tenantId);
    if (!tenantAllows) {
      return undefined;
    }
    const agentId = record.agent.type === 'reference' ? record.agent.id : null;
    const agentMemoryEnabled =
      agentId === null
        ? false
        : ((await agentStore.getAgent({ tenant_id: tenantId, id: agentId }))?.manifest.config.memory.enabled ?? false);
    const resolved = resolveMemoryScope({
      tenantId,
      createdBySubject: record.created_by_subject,
      agentId,
      agentMemoryEnabled,
      tfgSource: record.metadata['tfg.source'] ?? null,
      createAgentSession: record.metadata[CREATE_AGENT_SESSION_METADATA_KEY] === 'true',
    });
    if (resolved === undefined) {
      return undefined;
    }
    scope = resolved;
  } catch (error) {
    logger.warn('Memory unavailable for this turn', { error: error instanceof Error ? error.message : String(error) });
    return undefined;
  }

  let sessionStartSummary: string | undefined;
  if (record.last_turn_details === null) {
    sessionStartSummary = await fetchSessionStartSummary({
      provider: configured.provider,
      scope,
      timeoutMs: summaryTimeoutMs,
      logger,
    });
  } else {
    sessionStartSummary = undefined;
  }

  const scoped: ScopedMemory = {
    search: ({ query, limit }) => provider.search({ scope, query, limit }),
    add: ({ content }) => provider.addMemory({ scope, content, sessionId, createdAt: new Date().toISOString() }),
  };
  return memory({ memory: scoped, sessionStartSummary });
}

/**
 * Makes provider text safe to load as an internal message: the internal-message tags are defused so
 * it can't close the wrapper, and it is cut to fit {@link MEMORY_SUMMARY_MAX_TOKENS} at the last
 * sentence or line end that fits, else the last word end, else the last grapheme cluster.
 */
export function prepareSessionStartSummary(raw: string): { summary: string; truncated: boolean } {
  const summary = raw.replace(INTERNAL_TAG, '[$1tfy-internal]').trim();
  if (estimateTokensForString(summary) <= MEMORY_SUMMARY_MAX_TOKENS) {
    return { summary, truncated: false };
  }
  for (const cuts of [matchEnds(summary, SENTENCE_ENDS), matchEnds(summary, WORD_ENDS), graphemeEnds(summary)]) {
    const end = lastCutWithinTokenBudget(summary, cuts);
    if (end > 0) {
      return { summary: summary.slice(0, end).trim(), truncated: true };
    }
  }
  return { summary: '', truncated: true };
}

function* matchEnds(summary: string, pattern: RegExp): Generator<number> {
  for (const match of summary.matchAll(pattern)) {
    yield match.index + match[0].length;
  }
}

function* graphemeEnds(summary: string): Generator<number> {
  for (const { index, segment } of graphemeSegmenter.segment(summary)) {
    yield index + segment.length;
  }
}

function lastCutWithinTokenBudget(summary: string, cuts: Iterable<number>): number {
  let end = 0;
  for (const cut of cuts) {
    if (estimateTokensForString(summary.slice(0, cut)) > MEMORY_SUMMARY_MAX_TOKENS) {
      break;
    }
    end = cut;
  }
  return end;
}

/** Single bounded attempt; any failure means "no summary" so the turn starts on time. */
async function fetchSessionStartSummary({
  provider,
  scope,
  timeoutMs,
  logger,
}: {
  provider: ConfiguredMemory['provider'];
  scope: MemoryScope;
  timeoutMs: number;
  logger: Logger;
}): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  let raw: string | null;
  try {
    raw = await provider.getUserSummary({ scope, signal: controller.signal });
  } catch (error) {
    logger.warn('Memory summary unavailable; starting the session without it', {
      scope_type: scope.type,
      timed_out: controller.signal.aborted,
      error: error instanceof Error ? error.message : String(error),
    });
    return undefined;
  } finally {
    clearTimeout(timer);
  }
  const { summary, truncated } = prepareSessionStartSummary(raw ?? '');
  logger.info('Memory summary loaded', {
    scope_type: scope.type,
    summary_tokens: Math.ceil(estimateTokensForString(summary)),
    truncated,
  });
  return summary === '' ? undefined : summary;
}
