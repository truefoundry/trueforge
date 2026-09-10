import { TrueForge } from '@truefoundry/trueforge-sdk';
import type { Logger } from 'winston';
import { Controller } from './controller/Controller';
import { scheduleDispatchLoop, type ScheduleRunExecutor } from './controller/scheduleDispatch';
import type { IScheduleStore } from './db/scheduleStore';
import type { WithTransaction } from './db/transaction';
import { createTlsFetch, normalizeTlsUrl, type TlsOptions } from './http/tls';

/** HTTP transport for schedule dispatch (dedicated controller or standalone loopback). */
export function createHttpScheduleRunExecutor(params: {
  baseUrl: string;
  apiKey: string;
  tls: TlsOptions;
}): ScheduleRunExecutor {
  const tlsFetch = createTlsFetch(params.tls);
  const client = new TrueForge({
    baseUrl: normalizeTlsUrl({ url: params.baseUrl, enabled: params.tls.enabled }),
    token: params.apiKey,
    timeoutInSeconds: 60,
    ...(tlsFetch === undefined ? {} : { fetch: tlsFetch }),
  });
  return scheduleRunId => client.internal.schedules.executeRun({ scheduleRunId });
}

/**
 * Controller whose schedule loop hands runs to the server over HTTP
 * (`SERVER_URL` + `TRUEFORGE_API_KEY`). Standalone uses loopback; distributed uses
 * the dedicated controller process against the server Service.
 */
export function createController<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  baseUrl: string;
  apiKey: string;
  tls: TlsOptions;
}): Controller {
  return new Controller({
    loops: [
      scheduleDispatchLoop({
        scheduleStore: params.scheduleStore,
        executeRun: createHttpScheduleRunExecutor(params),
        withTransaction: params.withTransaction,
        logger: params.logger,
      }),
    ],
    logger: params.logger,
  });
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
