/**
 * Controller entry point (`dist/controller-main.js`).
 *
 * Runs the periodic control loops (schedule dispatch, …) as a dedicated,
 * single-replica process for distributed mode (`STANDALONE=false`). The controller
 * must run in exactly ONE process per database (see `controller/Controller.ts`);
 * in standalone mode the server process already owns it, so this entry refuses to
 * start there.
 *
 * Migrations are owned by the server (`main.ts`). This process only connects to the
 * already-migrated database; the loops have per-pass error boundaries, so they retry
 * each tick until the schema is present. The loops call the server over HTTP at
 * `CONTROLLER_SERVER_BASE_URL`, so no Redis peering is wired here.
 */
import { runController } from './controller';
import { createDb } from './db/postgres/client';
import { PostgresScheduleStore } from './db/postgres/schedule-store/PostgresScheduleStore';
import { createServerLogger } from './logger';
import { PACKAGE_VERSION } from './packageVersion';

// `./config` validates env at import time. Load it dynamically so a bad value is
// reported cleanly here instead of crashing during module evaluation.
let configuration: typeof import('./config').default;
try {
  ({ default: configuration } = await import('./config'));
} catch (error) {
  console.error('Failed to start controller: invalid configuration:', error instanceof Error ? error.message : error);
  process.exit(1);
}

try {
  const logger = createServerLogger({
    level: configuration.LOG_LEVEL,
    standalone: configuration.STANDALONE,
    version: PACKAGE_VERSION,
  });

  if (configuration.STANDALONE) {
    // Not an error: in standalone the server process owns the controller in-process, so a
    // dedicated controller has nothing to do. Exit cleanly (e.g. `pnpm standalone:dev` also
    // starts this script). Run with STANDALONE=false to use it as a dedicated process.
    logger.warn('Standalone mode (STANDALONE=true): the server runs the controller in-process; nothing to do here.');
    process.exit(0);
  }

  const db = createDb({
    connectionString: configuration.DATABASE_URL,
    poolMax: configuration.DATABASE_POOL_MAX,
    statementTimeoutMs: configuration.POSTGRES_STATEMENT_TIMEOUT_MS,
    idleInTransactionSessionTimeoutMs: configuration.POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS,
  });

  logger.info('Controller starting', {
    mode: 'distributed',
    serverBaseUrl: configuration.CONTROLLER_SERVER_BASE_URL,
  });

  runController({
    scheduleStore: new PostgresScheduleStore(db),
    withTransaction: callback => db.transaction().execute(callback),
    logger,
    baseUrl: configuration.CONTROLLER_SERVER_BASE_URL,
    gracefulTimeoutSeconds: configuration.GRACEFUL_TIMEOUT_SECONDS,
    onStopped: () => db.destroy(),
  });
} catch (error) {
  console.error('Failed to start controller:', error instanceof Error ? error.message : error);
  process.exit(1);
}
