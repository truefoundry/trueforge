import type { Logger } from 'winston';
import { Controller, type ControlLoop } from './controller/Controller';
import { memoryIngestLoop, type MemoryIngestWiring } from './controller/memoryIngest';
import { sandboxEnvBuildLoop } from './controller/sandboxEnvBuild';
import { scheduleDispatchLoop } from './controller/scheduleDispatch';
import type { IScheduleStore } from './db/scheduleStore';
import type { WithTransaction } from './db/transaction';

/**
 * Controller whose schedule loop hands runs to the server over HTTP
 * (`SERVER_URL` + `TRUEFORGE_API_KEY` from process config). Standalone uses
 * loopback; distributed uses the dedicated controller against the server Service.
 * Sandbox-env build loop lists/progresses pending versions over the same HTTP path.
 * The memory-ingest loop is registered only when `memory` is given (TRUEFOUNDRY_MEMORY_ENABLED); it reads
 * the database directly and calls the memory provider, not the server.
 */
export function createController<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  memory?: MemoryIngestWiring | undefined;
}): Controller {
  const loops: ControlLoop[] = [
    scheduleDispatchLoop({
      scheduleStore: params.scheduleStore,
      withTransaction: params.withTransaction,
      logger: params.logger,
    }),
    sandboxEnvBuildLoop({ logger: params.logger }),
  ];
  if (params.memory !== undefined) {
    loops.push(memoryIngestLoop({ ...params.memory, logger: params.logger, now: () => new Date() }));
  }
  return new Controller({ loops, logger: params.logger });
}

/**
 * Runs the controller: starts the loops and drains them on SIGTERM/SIGINT.
 */
export function runController<TTransaction>(params: {
  scheduleStore: IScheduleStore<TTransaction>;
  withTransaction: WithTransaction<TTransaction>;
  logger: Logger;
  memory?: MemoryIngestWiring | undefined;
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
      logger.warn(`Controller drain timed out after ${String(gracefulTimeoutSeconds)}s, exiting`, {
        reportable_error: {
          error: new Error(`Controller drain timed out after ${String(gracefulTimeoutSeconds)}s, exiting`),
        },
      });
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
