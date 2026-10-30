/**
 * Control loop: send finished exchanges of eligible sessions to the memory provider and record a
 * per-session checkpoint. Runs in the controller; provider calls are made outside any transaction.
 */
import type { Logger } from 'winston';
import type { DistributedServerConfiguration } from '../config';
import type {
  IMemoryIngestStore,
  MemoryIngestCandidate,
  MemoryIngestCandidateKey,
  MemoryIngestTurn,
} from '../db/memoryIngestStore';
import { createMemoryProvider } from '../memory/createMemoryProvider';
import {
  activePath,
  askUserQuestionsByToolCallId,
  buildExchanges,
  exchangeReadiness,
  renderExchange,
  resumePoint,
  type TurnExchange,
} from '../memory/exchanges';
import { MemoryIngestError, type MemoryProvider } from '../memory/MemoryProvider';
import { FlagMemorySettings, type MemorySettings } from '../memory/MemorySettings';
import { resolveMemoryScope, type MemoryScope } from '../memory/scope';
import type { ControlLoop } from './Controller';

const MEMORY_INGEST_LOOP_NAME = 'memory-ingest';
const DEFAULT_AGENT_NAME = 'TrueForge';

export interface MemoryIngestConfig {
  intervalMs: number;
  maxSessionsPerRun: number;
  maxExchangesPerSession: number;
  lookbackMs: number;
  pauseTimeoutMs: number;
  settleMs: number;
}

export interface MemoryIngestDeps {
  store: IMemoryIngestStore;
  provider: MemoryProvider;
  settings: MemorySettings;
  logger: Logger;
  config: MemoryIngestConfig;
  now?: () => Date;
}

export const MEMORY_INGEST_OUTCOMES = [
  'ingested',
  'not_ready',
  'tenant_disabled',
  'agent_disabled',
  'not_eligible',
  'fork',
  'failed',
] as const;
export type MemoryIngestOutcome = (typeof MEMORY_INGEST_OUTCOMES)[number];

interface SessionResult {
  outcome: MemoryIngestOutcome;
  exchangesSent: number;
  exchangesFailed: number;
  /** Seconds from each sent exchange's completion to its send. */
  lagsS: number[];
  /** Work is left for a later run (not ready, capped, or failed). */
  pending: boolean;
}

export interface MemoryIngestRunSummary {
  candidates: number;
  backlog: boolean;
  sessions_processed: number;
  sessions_by_outcome: Partial<Record<MemoryIngestOutcome, number>>;
  exchanges_sent: number;
  exchanges_failed: number;
  tenants_skipped_disabled: number;
  duration_ms: number;
  lag_p50_s: number | null;
  lag_max_s: number | null;
  oldest_pending_age_s: number | null;
}

export interface MemoryIngestRunResult {
  summary: MemoryIngestRunSummary;
  /** Where the next run continues; undefined → start from the oldest candidate. */
  resumeAfter: MemoryIngestCandidateKey | undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

function median(values: readonly number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle];
  if (upper === undefined) {
    return null;
  }
  const lower = sorted[middle - 1];
  return sorted.length % 2 === 0 && lower !== undefined ? (lower + upper) / 2 : upper;
}

/** Exchanges that may be sent now, in order, stopping at the first one that is not ready. */
function readyExchanges({
  exchanges,
  now,
  config,
}: {
  exchanges: readonly TurnExchange[];
  now: Date;
  config: MemoryIngestConfig;
}): { ready: TurnExchange[]; capped: boolean } {
  const ready: TurnExchange[] = [];
  for (const exchange of exchanges) {
    if (!exchangeReadiness({ exchange, now, settleMs: config.settleMs, pauseTimeoutMs: config.pauseTimeoutMs }).ready) {
      return { ready, capped: false };
    }
    if (ready.length === config.maxExchangesPerSession) {
      return { ready, capped: true };
    }
    ready.push(exchange);
  }
  return { ready, capped: false };
}

async function ingestSession({
  candidate,
  scope,
  deps,
  signal,
}: {
  candidate: MemoryIngestCandidate;
  scope: MemoryScope;
  deps: MemoryIngestDeps;
  signal: AbortSignal;
}): Promise<SessionResult> {
  const { store, provider, logger, config } = deps;
  const now = deps.now ?? (() => new Date());
  const { cursor } = candidate;
  const logFields = {
    session_id: candidate.session_id,
    tenant_id: candidate.tenant_id,
    scope_type: scope.type,
    agent_id: candidate.agent_id,
  };

  let threadId = cursor?.external_thread_id ?? null;
  let lastIngestedTurnId = cursor?.last_ingested_turn_id ?? null;

  const turns = await store.listSessionTurns({ session_id: candidate.session_id });
  const path = activePath({ turns, tipTurnId: candidate.tip_turn_id });
  const { startIndex, forked } = resumePoint({ path, turns, lastIngestedTurnId });
  if (forked) {
    logger.warn('Memory checkpoint is off the active path; resuming after the fork point', {
      ...logFields,
      last_ingested_turn_id: lastIngestedTurnId,
    });
  }

  const sentAt = now();
  const { ready, capped } = readyExchanges({ exchanges: buildExchanges(path.slice(startIndex)), now: sentAt, config });
  if (ready.length === 0) {
    return { outcome: forked ? 'fork' : 'not_ready', exchangesSent: 0, exchangesFailed: 0, lagsS: [], pending: true };
  }

  // A continuation's answer refers to a question asked in the turn before it.
  const previous: MemoryIngestTurn | undefined = path[startIndex - 1];
  const turnIds = [
    ...(previous === undefined ? [] : [previous.turn_id]),
    ...ready.flatMap(e => e.turns.map(t => t.turn_id)),
  ];
  const modelMessages = await store.listMainThreadModelMessages({
    session_id: candidate.session_id,
    turn_ids: turnIds,
  });
  const questions = askUserQuestionsByToolCallId(modelMessages.map(entry => entry.message));
  const agentName = candidate.agent_name ?? DEFAULT_AGENT_NAME;

  const lagsS: number[] = [];
  let exchangesSent = 0;
  for (const exchange of ready) {
    if (signal.aborted) {
      break;
    }
    const firstTurnId = exchange.turns[0].turn_id;
    const lastTurnId = exchange.turns[exchange.turns.length - 1]?.turn_id ?? firstTurnId;
    const messages = renderExchange({ exchange, questions, userName: scope.displayName, agentName });
    try {
      if (messages.length > 0) {
        const sent = await provider.ingestExchange({
          scope,
          exchange: { sessionId: candidate.session_id, firstTurnId, lastTurnId, messages },
          externalThreadId: threadId,
        });
        threadId = sent.externalThreadId;
        exchangesSent += 1;
        if (exchange.completedAt !== null) {
          lagsS.push(seconds(now().getTime() - Date.parse(exchange.completedAt)));
        }
      }
    } catch (error) {
      if (error instanceof MemoryIngestError && error.externalThreadId !== null) {
        threadId = error.externalThreadId;
      }
      const lastError = errorMessage(error);
      logger.error('Memory ingest failed for session', {
        ...logFields,
        exchanges_sent: exchangesSent,
        last_error: lastError,
        reportable_error: { error, extra: { ...logFields, first_turn_id: firstTurnId, last_turn_id: lastTurnId } },
      });
      await store.upsertCursor({
        session_id: candidate.session_id,
        last_ingested_turn_id: lastIngestedTurnId,
        external_thread_id: threadId,
        last_error: lastError.slice(0, 1_000),
      });
      return { outcome: 'failed', exchangesSent, exchangesFailed: 1, lagsS, pending: true };
    }
    lastIngestedTurnId = lastTurnId;
    await store.upsertCursor({
      session_id: candidate.session_id,
      last_ingested_turn_id: lastIngestedTurnId,
      external_thread_id: threadId,
      last_error: null,
    });
  }

  const pending = capped || lastIngestedTurnId !== candidate.tip_turn_id;
  logger.debug('Memory ingest session finished', {
    ...logFields,
    exchanges_sent: exchangesSent,
    lag_max_s: lagsS.length === 0 ? null : Math.max(...lagsS),
  });
  return {
    outcome: forked ? 'fork' : 'ingested',
    exchangesSent,
    exchangesFailed: 0,
    lagsS,
    pending,
  };
}

/**
 * One bounded pass: up to `maxSessionsPerRun` candidates after `resumeAfter`, one session in
 * memory at a time. Returns the run summary and where the next pass should continue.
 */
export async function runMemoryIngestPass({
  deps,
  signal,
  resumeAfter,
}: {
  deps: MemoryIngestDeps;
  signal: AbortSignal;
  resumeAfter: MemoryIngestCandidateKey | undefined;
}): Promise<MemoryIngestRunResult> {
  const { store, logger, config } = deps;
  const now = deps.now ?? (() => new Date());
  const startedAt = now();

  const listed = await store.listCandidateSessions({
    updated_since: new Date(startedAt.getTime() - config.lookbackMs - config.pauseTimeoutMs),
    ...(resumeAfter === undefined ? {} : { after: resumeAfter }),
    limit: config.maxSessionsPerRun + 1,
  });
  if (listed.length === 0 && resumeAfter !== undefined) {
    return await runMemoryIngestPass({ deps, signal, resumeAfter: undefined });
  }
  const backlog = listed.length > config.maxSessionsPerRun;
  const candidates = listed.slice(0, config.maxSessionsPerRun);

  const tenantEnabled = new Map<string, boolean>();
  const outcomes: Partial<Record<MemoryIngestOutcome, number>> = {};
  const lagsS: number[] = [];
  let exchangesSent = 0;
  let exchangesFailed = 0;
  let sessionsProcessed = 0;
  let oldestPendingMs: number | undefined;
  let lastVisited: MemoryIngestCandidate | undefined;

  const notePending = (candidate: MemoryIngestCandidate) => {
    const tipMs = Date.parse(candidate.tip_updated_at);
    oldestPendingMs = oldestPendingMs === undefined ? tipMs : Math.min(oldestPendingMs, tipMs);
  };

  for (const candidate of candidates) {
    if (signal.aborted) {
      break;
    }
    lastVisited = candidate;
    sessionsProcessed += 1;
    const result = await processCandidate({ candidate, deps, signal, tenantEnabled });
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    exchangesSent += result.exchangesSent;
    exchangesFailed += result.exchangesFailed;
    lagsS.push(...result.lagsS);
    if (result.pending) {
      notePending(candidate);
    }
  }
  for (const candidate of listed.slice(sessionsProcessed)) {
    notePending(candidate);
  }

  const tenantsSkipped = [...tenantEnabled.values()].filter(enabled => !enabled).length;
  const summary: MemoryIngestRunSummary = {
    candidates: listed.length,
    backlog,
    sessions_processed: sessionsProcessed,
    sessions_by_outcome: outcomes,
    exchanges_sent: exchangesSent,
    exchanges_failed: exchangesFailed,
    tenants_skipped_disabled: tenantsSkipped,
    duration_ms: now().getTime() - startedAt.getTime(),
    lag_p50_s: median(lagsS),
    lag_max_s: lagsS.length === 0 ? null : Math.max(...lagsS),
    oldest_pending_age_s: oldestPendingMs === undefined ? null : seconds(startedAt.getTime() - oldestPendingMs),
  };
  if (exchangesSent > 0 || exchangesFailed > 0 || backlog) {
    logger.info('Memory ingest run finished', summary);
  } else {
    logger.debug('Memory ingest run finished', summary);
  }

  // Continue after the last visited candidate while more remain; otherwise wrap to the oldest.
  const more = backlog || sessionsProcessed < candidates.length;
  return {
    summary,
    resumeAfter:
      more && lastVisited !== undefined
        ? { session_updated_at: lastVisited.session_updated_at, session_id: lastVisited.session_id }
        : undefined,
  };
}

async function processCandidate({
  candidate,
  deps,
  signal,
  tenantEnabled,
}: {
  candidate: MemoryIngestCandidate;
  deps: MemoryIngestDeps;
  signal: AbortSignal;
  tenantEnabled: Map<string, boolean>;
}): Promise<SessionResult> {
  const { settings, logger } = deps;
  const skipped = (outcome: MemoryIngestOutcome): SessionResult => ({
    outcome,
    exchangesSent: 0,
    exchangesFailed: 0,
    lagsS: [],
    pending: false,
  });

  let enabled = tenantEnabled.get(candidate.tenant_id);
  if (enabled === undefined) {
    try {
      enabled = await settings.isTenantMemoryEnabled(candidate.tenant_id);
    } catch (error) {
      logger.error('Memory settings lookup failed; skipping tenant for this run', {
        tenant_id: candidate.tenant_id,
        error: errorMessage(error),
        reportable_error: { error, extra: { tenant_id: candidate.tenant_id } },
      });
      return { ...skipped('failed'), pending: true };
    }
    tenantEnabled.set(candidate.tenant_id, enabled);
    if (!enabled) {
      logger.warn('Memory is disabled for tenant; skipping its sessions', { tenant_id: candidate.tenant_id });
    }
  }
  if (!enabled) {
    return skipped('tenant_disabled');
  }

  const resolution = resolveMemoryScope({
    tenantId: candidate.tenant_id,
    createdBySubject: candidate.created_by_subject,
    agentId: candidate.agent_id,
    agentMemoryEnabled: candidate.agent_memory_enabled,
    tfgSource: candidate.tfg_source,
  });
  if (!resolution.eligible) {
    return skipped(resolution.reason === 'agent_disabled' ? 'agent_disabled' : 'not_eligible');
  }

  try {
    return await ingestSession({ candidate, scope: resolution.scope, deps, signal });
  } catch (error) {
    // Store failures (loading turns, writing the checkpoint); the session is retried next run.
    logger.error('Memory ingest failed for session', {
      session_id: candidate.session_id,
      tenant_id: candidate.tenant_id,
      scope_type: resolution.scope.type,
      agent_id: candidate.agent_id,
      last_error: errorMessage(error),
      reportable_error: { error, extra: { session_id: candidate.session_id, tenant_id: candidate.tenant_id } },
    });
    return { ...skipped('failed'), pending: true };
  }
}

/** What the controller needs to register the loop; the controller supplies the logger. */
export type MemoryIngestWiring = Omit<MemoryIngestDeps, 'logger' | 'now'>;

type MemoryConfiguration = Pick<
  DistributedServerConfiguration,
  | 'TRUEFOUNDRY_MEMORY_ENABLED'
  | 'TRUEFOUNDRY_ZEP_API_KEY'
  | 'TRUEFOUNDRY_ZEP_BASE_URL'
  | 'MEMORY_INGEST_INTERVAL_MS'
  | 'MEMORY_INGEST_MAX_SESSIONS_PER_RUN'
  | 'MEMORY_INGEST_MAX_EXCHANGES_PER_SESSION'
  | 'MEMORY_INGEST_LOOKBACK_MS'
  | 'MEMORY_INGEST_PAUSE_TIMEOUT_MS'
  | 'MEMORY_INGEST_SETTLE_MS'
>;

/**
 * Loop wiring from TrueFoundry-mode configuration (like the shared sandbox and web search);
 * undefined while `TRUEFOUNDRY_MEMORY_ENABLED` is off.
 */
export function memoryIngestFromConfig({
  config,
  store,
  logger,
}: {
  config: MemoryConfiguration;
  store: IMemoryIngestStore;
  logger: Logger;
}): MemoryIngestWiring | undefined {
  if (!config.TRUEFOUNDRY_MEMORY_ENABLED) {
    return undefined;
  }
  if (config.TRUEFOUNDRY_ZEP_API_KEY === undefined) {
    throw new Error('TRUEFOUNDRY_MEMORY_ENABLED=true requires TRUEFOUNDRY_ZEP_API_KEY');
  }
  return {
    store,
    provider: createMemoryProvider({
      zep: { apiKey: config.TRUEFOUNDRY_ZEP_API_KEY, baseUrl: config.TRUEFOUNDRY_ZEP_BASE_URL },
      logger,
    }),
    settings: new FlagMemorySettings({ enabled: true }),
    config: {
      intervalMs: config.MEMORY_INGEST_INTERVAL_MS,
      maxSessionsPerRun: config.MEMORY_INGEST_MAX_SESSIONS_PER_RUN,
      maxExchangesPerSession: config.MEMORY_INGEST_MAX_EXCHANGES_PER_SESSION,
      lookbackMs: config.MEMORY_INGEST_LOOKBACK_MS,
      pauseTimeoutMs: config.MEMORY_INGEST_PAUSE_TIMEOUT_MS,
      settleMs: config.MEMORY_INGEST_SETTLE_MS,
    },
  };
}

export function memoryIngestLoop(deps: MemoryIngestDeps): ControlLoop {
  let resumeAfter: MemoryIngestCandidateKey | undefined;
  return {
    name: MEMORY_INGEST_LOOP_NAME,
    intervalMs: deps.config.intervalMs,
    async tick(signal) {
      if (signal.aborted) {
        return;
      }
      const result = await runMemoryIngestPass({ deps, signal, resumeAfter });
      resumeAfter = result.resumeAfter;
    },
  };
}
