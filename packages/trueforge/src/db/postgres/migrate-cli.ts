/**
 * Run pending Postgres migrations and exit.
 * Usage: `pnpm migrate` from packages/trueforge with `STANDALONE=false`.
 * SQLite migrations run automatically when the server boots in standalone mode.
 */
import configuration from '../../config';
import { migrateToLatest } from '../migratePostgres';
import { createDb } from './client';

if (configuration.STANDALONE) {
  throw new Error(
    'pnpm migrate targets Postgres only; set STANDALONE=false (and provide POSTGRES_* / Redis env as needed). SQLite migrations run on standalone server boot.',
  );
}

const db = createDb({
  connectionString: configuration.DATABASE_URL,
  poolMax: configuration.DATABASE_POOL_MAX,
  statementTimeoutMs: configuration.POSTGRES_STATEMENT_TIMEOUT_MS,
  idleInTransactionSessionTimeoutMs: configuration.POSTGRES_IDLE_IN_TRANSACTION_SESSION_TIMEOUT_MS,
});

try {
  await migrateToLatest(db);
} finally {
  await db.destroy();
}
