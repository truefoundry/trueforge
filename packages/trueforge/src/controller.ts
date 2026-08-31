import { TrueForge } from '@truefoundry/trueforge-sdk';
import type { Logger } from 'winston';
import { Controller } from './controller/Controller';
import { scheduleDispatchLoop } from './controller/scheduleDispatch';
import type { IScheduleStore } from './db/scheduleStore';
import type { WithTransaction } from './db/transaction';

/**
 * The loops the controller runs.
 */
export function createController<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  baseUrl: string;
}): Controller {
  const { scheduleStore, withTransaction, logger, baseUrl } = params;
  return new Controller({
    loops: [
      scheduleDispatchLoop({
        scheduleStore,
        client: new TrueForge({ baseUrl, auth: false }),
        withTransaction,
        logger,
      }),
    ],
    logger,
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
