/**
 * Run pending Postgres migrations and exit.
 * Usage: `pnpm migrate` from packages/server.
 * SQLite migrations are built into dist for packaging but are not run here.
 */
import configuration from '../../config';
import { migrateToLatest } from '../migratePostgres';
import { createDb } from './client';

const db = createDb(configuration.DATABASE_URL, configuration.DATABASE_POOL_MAX);

try {
  await migrateToLatest(db);
} finally {
  await db.destroy();
}
