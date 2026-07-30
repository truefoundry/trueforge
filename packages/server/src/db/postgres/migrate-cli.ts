/**
 * Run pending migrations and exit. Usage: `pnpm migrate` from packages/server.
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
