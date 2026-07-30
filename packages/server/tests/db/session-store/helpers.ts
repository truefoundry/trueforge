import { sql, type Kysely } from 'kysely';
import { Pool } from 'pg';
import { ulid } from 'ulid';

import { migrateToLatest } from '../../../src/db/migratePostgres';
import { createDb } from '../../../src/db/postgres/client';
import { PostgresSessionStore } from '../../../src/db/postgres/session-store/PostgresSessionStore';
import type { Database } from '../../../src/db/postgres/types';

const ADMIN_URL_ENV = 'PG_STORE_TESTS_ADMIN_URL';

export interface PostgresStoreEnvironment {
  store: PostgresSessionStore;
  reset: () => Promise<void>;
  teardown: () => Promise<void>;
}

async function truncateSessionStore(db: Kysely<Database>): Promise<void> {
  await sql`
    TRUNCATE TABLE
      thread_capability_state,
      session_event,
      thread_context_log,
      turn_thread,
      turn,
      session
    RESTART IDENTITY CASCADE
  `.execute(db);
}

function resolveAdminUrl(): string | undefined {
  const url = process.env[ADMIN_URL_ENV];
  if (url === undefined || url === '') {
    return undefined;
  }
  return url;
}

function withDatabase(connectionString: string, database: string): string {
  const parsed = new URL(connectionString.replace(/^postgres:/, 'http:'));
  parsed.pathname = `/${database}`;
  return parsed.toString().replace(/^http:/, 'postgres:');
}

function assertSafeDatabaseName(name: string): void {
  if (!/^[a-z0-9_]+$/.test(name)) {
    throw new Error(`invalid database name: ${name}`);
  }
}

async function dropDatabase(adminUrl: string, databaseName: string): Promise<void> {
  assertSafeDatabaseName(databaseName);
  const pool = new Pool({ connectionString: adminUrl });
  try {
    await pool.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()`,
      [databaseName],
    );
    await pool.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await pool.end();
  }
}

/**
 * Creates a throwaway database, migrates it, and returns a PostgresSessionStore bound to it.
 * Each test file should call this once in beforeAll and teardown in afterAll.
 */
export async function createPostgresStoreEnvironment(): Promise<PostgresStoreEnvironment | undefined> {
  const adminUrl = resolveAdminUrl();
  if (adminUrl === undefined) {
    return undefined;
  }

  const databaseName = `test_${ulid().toLowerCase()}`;
  assertSafeDatabaseName(databaseName);

  const adminPool = new Pool({ connectionString: adminUrl });
  try {
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  } catch (error) {
    await adminPool.end();
    throw error;
  } finally {
    await adminPool.end();
  }

  const databaseUrl = withDatabase(adminUrl, databaseName);
  const db = createDb(databaseUrl, 5);
  try {
    await migrateToLatest(db);
  } catch (error) {
    await db.destroy();
    await dropDatabase(adminUrl, databaseName);
    throw error;
  }

  const store = new PostgresSessionStore(db);
  return {
    store,
    reset: () => truncateSessionStore(db),
    async teardown() {
      await db.destroy();
      await dropDatabase(adminUrl, databaseName);
    },
  };
}
