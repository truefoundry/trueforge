/**
 * Run pending migrations and exit. Usage: `pnpm migrate` from packages/server.
 */
import configuration from '../config';
import { createDb } from './client';
import { migrateToLatest } from './migrate';

const db = createDb(configuration.DATABASE_URL, configuration.DATABASE_POOL_MAX);

try {
  await migrateToLatest(db);
} finally {
  await db.destroy();
}
