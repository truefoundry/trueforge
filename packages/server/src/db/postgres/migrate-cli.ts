/**
 * Run pending Postgres migrations and exit.
 * Usage: `pnpm migrate` from packages/server.
 * SQLite migrations are built into dist for packaging but are not run here.
 */
import configuration from '../../config';
import { migrateToLatest } from '../migratePostgres';
import { createDb } from './client';

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
