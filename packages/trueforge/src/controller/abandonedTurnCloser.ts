/**
 * Control loop: list stale running turns and close them over HTTP (batch per tick).
 */
import { TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { Logger } from 'winston';
import configuration from '../config';
import { captureCriticalException } from '../sentry';
import type { ControlLoop } from './Controller';
import { internalTrueForgeClient } from './internalTrueForgeClient';

const ABANDONED_TURN_CLOSER_LOOP_NAME = 'abandoned-turn-closer';

export async function dispatchAbandonedTurns({ logger }: { logger: Logger }): Promise<void> {
  const abandoned = await internalTrueForgeClient.listAbandonedTurns();
  const batch = abandoned.slice(0, configuration.ABANDONED_TURN_CLOSE_BATCH);
  logger.debug('Abandoned turn closer tick', {
    abandoned_count: abandoned.length,
    close_batch: batch.length,
  });
  for (const turn of batch) {
    logger.debug('Closing abandoned turn', {
      tenant_id: turn.tenantId,
      session_id: turn.sessionId,
      turn_id: turn.turnId,
    });
    try {
      await internalTrueForgeClient.closeAbandonedTurn(turn);
      logger.debug('Abandoned turn closed', {
        tenant_id: turn.tenantId,
        session_id: turn.sessionId,
        turn_id: turn.turnId,
      });
    } catch (error) {
      if (error instanceof TrueForgeApi.NotFoundError) {
        logger.warn('Abandoned turn session not found; skipping', {
          tenant_id: turn.tenantId,
          session_id: turn.sessionId,
          turn_id: turn.turnId,
        });
        captureCriticalException(error, {
          tags: { module: 'abandonedTurnCloser', operation: 'closeNotFound' },
          extra: {
            tenant_id: turn.tenantId,
            session_id: turn.sessionId,
            turn_id: turn.turnId,
          },
        });
        continue;
      }
      logger.error('Abandoned turn close failed', {
        tenant_id: turn.tenantId,
        session_id: turn.sessionId,
        turn_id: turn.turnId,
        error: error instanceof Error ? error.message : String(error),
      });
      captureCriticalException(error, {
        tags: { module: 'abandonedTurnCloser', operation: 'close' },
        extra: {
          tenant_id: turn.tenantId,
          session_id: turn.sessionId,
          turn_id: turn.turnId,
        },
      });
    }
  }
}

export function abandonedTurnCloserLoop(params: { logger: Logger }): ControlLoop {
  return {
    name: ABANDONED_TURN_CLOSER_LOOP_NAME,
    intervalMs: configuration.ABANDONED_TURN_CLOSER_INTERVAL_MS,
    async tick(signal) {
      if (signal.aborted) {
        return;
      }
      await dispatchAbandonedTurns({ logger: params.logger });
    },
  };
}
