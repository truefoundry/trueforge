/**
 * Run pending Postgres migrations and exit.
 * Usage: `pnpm migrate` from packages/server.
 * Requires `DATABASE_BACKEND=postgres` (the default when `STANDALONE=false`)
 * so `DATABASE_URL` resolves from `POSTGRES_*`. SQLite migrations run
 * automatically when the server boots with `DATABASE_BACKEND=sqlite`.
 */
import configuration from '../../config';
import { migrateToLatest } from '../migratePostgres';
import { createDb } from './client';

if (configuration.DATABASE_URL === undefined) {
  throw new Error(
    'pnpm migrate targets Postgres only. Set DATABASE_BACKEND=postgres (or STANDALONE=false) and POSTGRES_* (see .env.example).',
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
