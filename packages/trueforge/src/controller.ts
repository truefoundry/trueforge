/**
 * Controller entry point — the control loops as their own process.
 *
 * Distributed mode only. Server replicas run no loops, so this deployment is the sole
 * controller for the database. Loops assume no peer runs alongside them,
 * so it MUST have exactly one replica.
 *
 * In standalone mode the controller runs inside the server instead — one process owns
 * everything, and this entry point refuses to start.
 */
import { extractErrorLogFields } from '@truefoundry/trueforge-core/core';

let configuration: typeof import('./config').default;

try {
  ({ default: configuration } = await import('./config'));
} catch (error) {
  console.error(
    'Failed to start controller: Failed to load configuration:',
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
}

import { Controller } from './controller/Controller';
import { createScheduleDispatchLoop, logTriggeredRun } from './controller/scheduleDispatch';
import { createDb } from './db/postgres/client';
import { PostgresScheduleStore } from './db/postgres/schedule-store/PostgresScheduleStore';
import { createServerLogger } from './logger';
import { PACKAGE_VERSION } from './packageVersion';

try {
  const logger = createServerLogger({
    level: configuration.LOG_LEVEL,
    standalone: configuration.STANDALONE,
    version: PACKAGE_VERSION,
  });

  // Narrow through a const: the config union is keyed on STANDALONE, and only the
  // distributed variant carries the Postgres connection settings.
  const config = configuration;
  if (config.STANDALONE) {
    throw new Error(
      'The controller process is for distributed mode only. ' +
        'In standalone mode the server runs the control loops in-process.',
    );
  }

  const db = createDb({
    connectionString: config.DATABASE_URL,
    poolMax: config.DATABASE_POOL_MAX,
    statementTimeoutMs: config.POSTGRES_STATEMENT_TIMEOUT_MS,
    idleInTransactionSessionTimeoutMs: config.POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS,
  });
  const controller = new Controller({
    loops: [
      createScheduleDispatchLoop({
        scheduleStore: new PostgresScheduleStore(db),
        withTransaction: callback => db.transaction().execute(callback),
        onTriggered: logTriggeredRun(logger),
        logger,
      }),
    ],
    logger,
  });

  logger.info('TrueForge controller starting', { mode: 'distributed' });
  controller.start();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    logger.info(`Received ${signal}, stopping control loops`);

    // Start the deadline at the top of shutdown; unref so this timer alone cannot keep the process
    // alive. Passes only hold short transactions, so this should never elapse.
    setTimeout(() => {
      logger.warn(`Controller drain timed out after ${String(configuration.GRACEFUL_TIMEOUT_SECONDS)}s, exiting`);
      process.exit(1);
    }, configuration.GRACEFUL_TIMEOUT_SECONDS * 1000).unref();

    await controller.stop();
    await db.destroy().catch((error: unknown) => {
      logger.warn('Error closing the database pool during shutdown', extractErrorLogFields(error));
    });
    process.exit(0);
  };
  process.on('SIGTERM', signal => {
    void shutdown(signal);
  });
  process.on('SIGINT', signal => {
    void shutdown(signal);
  });
} catch (error) {
  console.error('Failed to start controller:', error instanceof Error ? error.message : error);
  process.exit(1);
}
