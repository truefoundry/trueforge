/**
 * Run pending Postgres migrations and exit.
 * Usage: `pnpm migrate` from packages/server.
 * Requires `SINGLE_BINARY=false` (or any mode that resolves `DATABASE_URL`
 * from `POSTGRES_*`). SQLite migrations run automatically on single-binary boot.
 */
import configuration from '../../config';
import { migrateToLatest } from '../migratePostgres';
import { createDb } from './client';

if (configuration.DATABASE_URL === undefined) {
  throw new Error('pnpm migrate targets Postgres only. Set SINGLE_BINARY=false and POSTGRES_* (see .env.example).');
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
