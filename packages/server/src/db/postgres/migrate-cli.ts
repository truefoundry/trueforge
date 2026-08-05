/**
 * Run pending Postgres migrations and exit.
 * Usage: `pnpm migrate` from packages/server.
 * The script pins `DATABASE_BACKEND=postgres` (process env wins over
 * `--env-file`), so `DATABASE_URL` resolves from `POSTGRES_*` regardless of the
 * `.env` backend. SQLite migrations run automatically when the server boots
 * with `DATABASE_BACKEND=sqlite`.
 */
import configuration from '../../config';
import { migrateToLatest } from '../migratePostgres';
import { createDb } from './client';

if (configuration.DATABASE_URL === undefined) {
  throw new Error(
    'pnpm migrate targets Postgres only and expects DATABASE_BACKEND=postgres; DATABASE_URL did not resolve from POSTGRES_* (see .env.example).',
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
