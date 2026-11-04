/**
 * Control loop: send finished exchanges of eligible sessions to the memory provider and record a
 * per-session checkpoint. Runs in the controller; provider calls are made outside any transaction.
 */
import type { Logger } from 'winston';
import type { DistributedServerConfiguration } from '../config';
import type { IMemoryIngestStore, MemoryIngestCandidate, MemoryIngestTurn } from '../db/memoryIngestStore';
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
import { TenantAllowlistMemorySettings, type MemorySettings } from '../memory/MemorySettings';
import { resolveMemoryScope, type MemoryScope } from '../memory/scope';
import { resolveTrueFoundryMemoryProviderConfig } from '../truefoundry/resolveTrueFoundryMemoryProviderConfig';
import type { ControlLoop } from './Controller';

const MEMORY_INGEST_LOOP_NAME = 'memory-ingest';

export interface MemoryIngestConfig {
  intervalMs: number;
  maxSessionsPerRun: number;
  maxExchangesPerSession: number;
  lookbackMs: number;
  pauseTimeoutMs: number;
}

export interface MemoryIngestDeps {
  store: IMemoryIngestStore;
  provider: MemoryProvider;
  settings: MemorySettings;
  logger: Logger;
  config: MemoryIngestConfig;
  now: () => Date;
}

export type MemoryIngestOutcome = 'ingested' | 'not_ready' | 'memory_disabled' | 'failed';

interface SessionResult {
  outcome: MemoryIngestOutcome;
  exchangesSent: number;
  exchangesFailed: number;
}

export interface MemoryIngestRunSummary {
  sessions: number;
  backlog: boolean;
  sessions_by_outcome: Partial<Record<MemoryIngestOutcome, number>>;
  exchanges_sent: number;
  exchanges_failed: number;
  duration_ms: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
}): TurnExchange[] {
  const ready: TurnExchange[] = [];
  for (const exchange of exchanges) {
    if (
      ready.length === config.maxExchangesPerSession ||
      !exchangeReadiness({ exchange, now, pauseTimeoutMs: config.pauseTimeoutMs }).ready
    ) {
      break;
    }
    ready.push(exchange);
  }
  return ready;
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
  const { store, provider, logger, config, now } = deps;
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

  const ready = readyExchanges({ exchanges: buildExchanges(path.slice(startIndex)), now: now(), config });
  if (ready.length === 0) {
    return { outcome: 'not_ready', exchangesSent: 0, exchangesFailed: 0 };
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

  let exchangesSent = 0;
  // The last attempt failed on the next exchange, possibly after the provider stored it.
  let mayAlreadyBeStored = cursor !== null && cursor.last_error !== null;
  for (const exchange of ready) {
    if (signal.aborted) {
      break;
    }
    const firstTurnId = exchange.turns[0].turn_id;
    const lastTurnId = exchange.turns[exchange.turns.length - 1]?.turn_id ?? firstTurnId;
    const messages = renderExchange({ exchange, questions });
    try {
      if (messages.length > 0) {
        const sent = await provider.ingestExchange({
          scope,
          exchange: { sessionId: candidate.session_id, lastTurnId, messages },
          externalThreadId: threadId,
          mayAlreadyBeStored,
        });
        threadId = sent.externalThreadId;
        mayAlreadyBeStored = false;
        exchangesSent += 1;
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
      return { outcome: 'failed', exchangesSent, exchangesFailed: 1 };
    }
    lastIngestedTurnId = lastTurnId;
    await store.upsertCursor({
      session_id: candidate.session_id,
      last_ingested_turn_id: lastIngestedTurnId,
      external_thread_id: threadId,
      last_error: null,
    });
  }

  logger.debug('Memory ingest session finished', { ...logFields, exchanges_sent: exchangesSent });
  return { outcome: 'ingested', exchangesSent, exchangesFailed: 0 };
}

/**
 * One bounded pass over the oldest `maxSessionsPerRun` candidates, one session in memory at a time.
 * Keeps no state between passes: every pass starts from the oldest candidate.
 */
export async function runMemoryIngestPass({
  deps,
  signal,
}: {
  deps: MemoryIngestDeps;
  signal: AbortSignal;
}): Promise<MemoryIngestRunSummary> {
  const { store, settings, logger, config, now } = deps;
  const startedAt = now();

  // Recent sessions within the lookback; paused ones only once their pause has timed out, for one
  // lookback-wide range. A paused session the user answers gets a new turn and so becomes recent.
  const startedMs = startedAt.getTime();
  const tenantIds = await settings.listEnabledTenantIds();
  const listed =
    tenantIds?.length === 0
      ? []
      : await store.listCandidateSessions({
          tenant_ids: tenantIds,
          recent_since: new Date(startedMs - config.lookbackMs),
          paused_from: new Date(startedMs - config.pauseTimeoutMs - config.lookbackMs),
          paused_until: new Date(startedMs - config.pauseTimeoutMs),
          limit: config.maxSessionsPerRun + 1,
        });
  const backlog = listed.length > config.maxSessionsPerRun;
  const candidates = listed.slice(0, config.maxSessionsPerRun);

  const outcomes: Partial<Record<MemoryIngestOutcome, number>> = {};
  let exchangesSent = 0;
  let exchangesFailed = 0;
  let sessionsProcessed = 0;

  for (const candidate of candidates) {
    if (signal.aborted) {
      break;
    }
    sessionsProcessed += 1;
    const result = await processCandidate({ candidate, deps, signal });
    outcomes[result.outcome] = (outcomes[result.outcome] ?? 0) + 1;
    exchangesSent += result.exchangesSent;
    exchangesFailed += result.exchangesFailed;
  }

  const summary: MemoryIngestRunSummary = {
    sessions: sessionsProcessed,
    backlog,
    sessions_by_outcome: outcomes,
    exchanges_sent: exchangesSent,
    exchanges_failed: exchangesFailed,
    duration_ms: now().getTime() - startedAt.getTime(),
  };
  if (exchangesSent > 0 || exchangesFailed > 0 || backlog) {
    logger.info('Memory ingest run finished', summary);
  } else {
    logger.debug('Memory ingest run finished', summary);
  }
  return summary;
}

async function processCandidate({
  candidate,
  deps,
  signal,
}: {
  candidate: MemoryIngestCandidate;
  deps: MemoryIngestDeps;
  signal: AbortSignal;
}): Promise<SessionResult> {
  const { logger } = deps;
  const skipped = (outcome: MemoryIngestOutcome): SessionResult => ({
    outcome,
    exchangesSent: 0,
    exchangesFailed: 0,
  });

  const scope = resolveMemoryScope({
    tenantId: candidate.tenant_id,
    createdBySubject: candidate.created_by_subject,
    agentId: candidate.agent_id,
    agentMemoryEnabled: candidate.agent_memory_enabled,
    tfgSource: candidate.tfg_source,
    createAgentSession: candidate.create_agent_session,
  });
  if (scope === undefined) {
    return skipped('memory_disabled');
  }

  try {
    return await ingestSession({ candidate, scope, deps, signal });
  } catch (error) {
    // Store failures (loading turns, writing the checkpoint); the session is retried next run.
    logger.error('Memory ingest failed for session', {
      session_id: candidate.session_id,
      tenant_id: candidate.tenant_id,
      scope_type: scope.type,
      agent_id: candidate.agent_id,
      last_error: errorMessage(error),
      reportable_error: { error, extra: { session_id: candidate.session_id, tenant_id: candidate.tenant_id } },
    });
    return skipped('failed');
  }
}

/** What the controller needs to register the loop; the controller supplies the logger. */
export type MemoryIngestWiring = Omit<MemoryIngestDeps, 'logger' | 'now'>;

type MemoryConfiguration = Pick<
  DistributedServerConfiguration,
  | 'TRUEFOUNDRY_MEMORY_ENABLED'
  | 'TRUEFOUNDRY_MEMORY_PROVIDER'
  | 'TRUEFOUNDRY_MEMORY_API_KEY'
  | 'TRUEFOUNDRY_MEMORY_SERVER_URL'
  | 'TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST'
  | 'TRUEFOUNDRY_MEMORY_SETTINGS'
>;

/**
 * Loop wiring from TrueFoundry-mode configuration; undefined while `TRUEFOUNDRY_MEMORY_ENABLED` is off.
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
  const providerConfig = resolveTrueFoundryMemoryProviderConfig(config);
  if (providerConfig === undefined) {
    return undefined;
  }
  const { settings } = providerConfig;
  return {
    store,
    provider: createMemoryProvider({ config: providerConfig, logger }),
    settings: new TenantAllowlistMemorySettings({ tenantIds: config.TRUEFOUNDRY_MEMORY_TENANT_ALLOWLIST }),
    config: {
      intervalMs: settings.interval_ms,
      maxSessionsPerRun: settings.max_sessions_per_run,
      maxExchangesPerSession: settings.max_exchanges_per_session,
      lookbackMs: settings.lookback_ms,
      pauseTimeoutMs: settings.pause_timeout_ms,
    },
  };
}

export function memoryIngestLoop(deps: MemoryIngestDeps): ControlLoop {
  return {
    name: MEMORY_INGEST_LOOP_NAME,
    intervalMs: deps.config.intervalMs,
    async tick(signal) {
      if (signal.aborted) {
        return;
      }
      await runMemoryIngestPass({ deps, signal });
    },
  };
}
