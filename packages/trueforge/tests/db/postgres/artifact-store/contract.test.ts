import { sql } from 'kysely';

import { PostgresArtifactStore } from '../../../../src/db/postgres/artifact-store/PostgresArtifactStore';
import { PostgresSessionStore } from '../../../../src/db/postgres/session-store/PostgresSessionStore';
import { runArtifactStoreContractSuite } from '../../artifactStoreContractSuite';
import { createPostgresTestDatabase, type PostgresTestDatabase } from '../testDatabase';

jest.mock('ulid', () => {
  const actual = jest.requireActual<typeof import('ulid')>('ulid');
  return { ...actual, ulid: jest.fn(actual.ulid) };
});

const describePg = process.env['PG_STORE_TESTS_ENABLED'] === '1' ? describe : describe.skip;

describePg('PostgresArtifactStore (IArtifactStore contract)', () => {
  let env: PostgresTestDatabase | undefined;

  beforeAll(async () => {
    env = await createPostgresTestDatabase();
    if (env === undefined) {
      throw new Error('Postgres test environment unavailable despite globalSetup probe');
    }
  }, 120_000);

  afterAll(async () => {
    await env?.teardown();
  });

  beforeEach(async () => {
    if (env !== undefined) {
      await sql`TRUNCATE TABLE artifact, artifact_version, session CASCADE`.execute(env.db);
    }
  });

  runArtifactStoreContractSuite(() => {
    if (env === undefined) {
      throw new Error('Postgres test environment not initialized');
    }
    return { store: new PostgresArtifactStore(env.db), sessionStore: new PostgresSessionStore(env.db) };
  });
});
