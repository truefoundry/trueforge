import type { Logger } from 'winston';
import { Controller } from './controller/Controller';
import { scheduleDispatchLoop, type ScheduleRunExecutor } from './controller/scheduleDispatch';
import type { IScheduleStore } from './db/scheduleStore';
import type { WithTransaction } from './db/transaction';
import { createTlsFetch, normalizeTlsUrl, type TlsOptions } from './http/tls';

/** HTTP transport used by the dedicated controller process. */
export function createHttpScheduleRunExecutor(params: {
  baseUrl: string;
  apiKey: string;
  tls: TlsOptions;
}): ScheduleRunExecutor {
  const baseUrl = normalizeTlsUrl({ url: params.baseUrl, enabled: params.tls.enabled });
  const fetchImpl = createTlsFetch(params.tls) ?? fetch;
  const url = new URL('/api/internal/schedules/runs/execute', baseUrl);
  return async scheduleRunId => {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ schedule_run_id: scheduleRunId }),
    });
    if (!response.ok) {
      throw new Error(`Schedule execution request failed with status ${String(response.status)}`);
    }
  };
}

function createControllerWithExecutor<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  executeRun: ScheduleRunExecutor;
}): Controller {
  const { scheduleStore, withTransaction, logger, executeRun } = params;
  return new Controller({
    loops: [
      scheduleDispatchLoop({
        scheduleStore,
        executeRun,
        withTransaction,
        logger,
      }),
    ],
    logger,
  });
}

/** Controller for the dedicated process; schedule execution is handed to the server over HTTP. */
export function createController<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  baseUrl: string;
  apiKey: string;
  tls: TlsOptions;
}): Controller {
  return createControllerWithExecutor({
    scheduleStore: params.scheduleStore,
    withTransaction: params.withTransaction,
    logger: params.logger,
    executeRun: createHttpScheduleRunExecutor(params),
  });
}

/** Controller colocated with the standalone server; schedule execution stays in-process. */
export function createInProcessController<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  executeRun: ScheduleRunExecutor;
}): Controller {
  return createControllerWithExecutor(params);
}

/**
 * Runs the controller: starts the loops and drains them on SIGTERM/SIGINT.
 */
export function runController<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  baseUrl: string;
  apiKey: string;
  tls: TlsOptions;
  gracefulTimeoutSeconds: number;
  /** Releases what the caller opened for the loops, e.g. its database pool. */
  onStopped?: () => Promise<void>;
}): Controller {
  const { logger, gracefulTimeoutSeconds, onStopped } = params;
  const controller = createController(params);
  controller.start();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, stopping control loops`);

    // Passes only hold short transactions, so the deadline should never elapse.
    setTimeout(() => {
      logger.warn(`Controller drain timed out after ${String(gracefulTimeoutSeconds)}s, exiting`);
      process.exit(1);
    }, gracefulTimeoutSeconds * 1000).unref();

    await controller.stop();
    await onStopped?.();
    process.exit(0);
  };
  process.on('SIGTERM', signal => {
    void shutdown(signal);
  });
  process.on('SIGINT', signal => {
    void shutdown(signal);
  });

  return controller;
}
