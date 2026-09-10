import { TrueForge } from '@truefoundry/trueforge-sdk';
import type { Logger } from 'winston';
import { Controller } from './controller/Controller';
import { scheduleDispatchLoop } from './controller/scheduleDispatch';
import type { IScheduleStore } from './db/scheduleStore';
import type { WithTransaction } from './db/transaction';
import { createTlsFetch, normalizeTlsUrl, type TlsOptions } from './http/tls';

function createScheduleApiClient(params: { baseUrl: string; tls: TlsOptions }): TrueForge {
  const baseUrl = normalizeTlsUrl({ url: params.baseUrl, enabled: params.tls.enabled });
  const fetchImpl = createTlsFetch(params.tls);
  return new TrueForge({
    baseUrl,
    auth: false,
    ...(fetchImpl !== undefined ? { fetch: fetchImpl } : {}),
  });
}

/**
 * The loops the controller runs.
 */
export function createController<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  baseUrl: string;
  tls?: TlsOptions;
}): Controller {
  const { scheduleStore, withTransaction, logger, baseUrl } = params;
  const tls = params.tls ?? { enabled: false, dir: '' };
  return new Controller({
    loops: [
      scheduleDispatchLoop({
        scheduleStore,
        client: createScheduleApiClient({ baseUrl, tls }),
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
  tls?: TlsOptions;
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
