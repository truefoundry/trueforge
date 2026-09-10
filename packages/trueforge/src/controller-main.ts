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
 * each tick until the schema is present. The loops call the server over HTTP(S) at
 * `SERVER_URL` (mutual TLS when `TRUEFORGE_MTLS_ENABLED`), so no Redis peering is wired here.
 */
import configuration from './config';
import { runController } from './controller';
import { createDb } from './db/postgres/client';
import { PostgresScheduleStore } from './db/postgres/schedule-store/PostgresScheduleStore';
import { createControllerLogger } from './logger';
import { PACKAGE_VERSION } from './packageVersion';

try {
  const logger = createControllerLogger({
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

  const mtls = {
    enabled: configuration.TRUEFORGE_MTLS_ENABLED,
    dir: configuration.TRUEFORGE_MTLS_CERTS_DIR,
  };

  logger.info('Controller starting', {
    serverUrl: configuration.SERVER_URL,
    mTlsEnabled: mtls.enabled,
  });

  runController({
    scheduleStore: new PostgresScheduleStore(db),
    withTransaction: callback => db.transaction().execute(callback),
    logger,
    baseUrl: configuration.SERVER_URL,
    tls: mtls,
    gracefulTimeoutSeconds: configuration.GRACEFUL_TIMEOUT_SECONDS,
    onStopped: () => db.destroy(),
  });
} catch (error) {
  console.error('Failed to start controller:', error instanceof Error ? error.message : error);
  process.exit(1);
}
