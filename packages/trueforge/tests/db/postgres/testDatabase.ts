/**
 * Creates a throwaway, fully migrated Postgres database for store tests.
 * Returns undefined when globalSetup found no reachable Postgres (suite skips).
 */
import type { Kysely } from 'kysely';
import { Pool } from 'pg';

import { migrateTo, migrateToLatest } from '../../../src/db/migratePostgres';
import { createDb } from '../../../src/db/postgres/client';
import type { Database } from '../../../src/db/postgres/types';
import { newId } from '../../../src/utils/id';

const ADMIN_URL_ENV = 'PG_STORE_TESTS_ADMIN_URL';

export interface PostgresTestDatabase {
  db: Kysely<Database>;
  teardown: () => Promise<void>;
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

export async function createPostgresTestDatabase(
  targetMigrationName?: string,
): Promise<PostgresTestDatabase | undefined> {
  const adminUrl = resolveAdminUrl();
  if (adminUrl === undefined) {
    return undefined;
  }

  const databaseName = `test_${newId()}`;
  assertSafeDatabaseName(databaseName);

  const adminPool = new Pool({ connectionString: adminUrl });
  try {
    await adminPool.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await adminPool.end();
  }

  const databaseUrl = withDatabase(adminUrl, databaseName);
  const db = createDb({
    connectionString: databaseUrl,
    poolMax: 5,
    statementTimeoutMs: 60_000,
    idleInTransactionSessionTimeoutMs: 60_000,
  });
  try {
    if (targetMigrationName === undefined) {
      await migrateToLatest(db);
    } else {
      await migrateTo(db, targetMigrationName);
    }
  } catch (error) {
    await db.destroy();
    await dropDatabase(adminUrl, databaseName);
    throw error;
  }

  return {
    db,
    async teardown() {
      await db.destroy();
      await dropDatabase(adminUrl, databaseName);
    },
  };
}
