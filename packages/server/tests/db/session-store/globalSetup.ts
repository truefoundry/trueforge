/**
 * Probes for a reachable Postgres before the store suite runs and publishes the
 * outcome through the environment, so the suite can skip rather than fail when
 * no database is available.
 */
import { connect } from 'node:net';
import { Pool } from 'pg';

const CONFIGURED_URL_ENV = 'SESSION_STORE_TEST_PG_URL';
const ENABLED_ENV = 'PG_STORE_TESTS_ENABLED';
const ADMIN_URL_ENV = 'PG_STORE_TESTS_ADMIN_URL';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 55432;
const DEFAULT_URL = 'postgres://proto:proto@localhost:55432/proto';

function isPortOpen(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>(resolve => {
    const socket = connect({ host, port });
    socket.setTimeout(2000);
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => {
      resolve(false);
    });
  });
}

async function probeUrl(url: string): Promise<boolean> {
  const pool = new Pool({ connectionString: url, connectionTimeoutMillis: 3000 });
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

export default async function setupPostgresStoreTests(): Promise<void> {
  const configuredUrl = process.env[CONFIGURED_URL_ENV];
  if (configuredUrl !== undefined && configuredUrl !== '') {
    if (await probeUrl(configuredUrl)) {
      process.env[ENABLED_ENV] = '1';
      process.env[ADMIN_URL_ENV] = configuredUrl;
      return;
    }
  }

  if (await isPortOpen(DEFAULT_HOST, DEFAULT_PORT)) {
    if (await probeUrl(DEFAULT_URL)) {
      process.env[ENABLED_ENV] = '1';
      process.env[ADMIN_URL_ENV] = DEFAULT_URL;
      console.log(`Postgres store tests: using default local URL (${CONFIGURED_URL_ENV} unset)`);
      return;
    }
  }

  process.env[ENABLED_ENV] = '0';
  console.warn(
    `Postgres store tests skipped: set ${CONFIGURED_URL_ENV} or start Postgres on ${DEFAULT_HOST}:${String(DEFAULT_PORT)}`,
  );
}
