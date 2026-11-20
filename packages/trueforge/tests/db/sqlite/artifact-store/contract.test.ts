import { SqliteArtifactStore } from '../../../../src/db/sqlite/artifact-store/SqliteArtifactStore';
import { runArtifactStoreContractSuite } from '../../artifactStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

jest.mock('ulid', () => {
  const actual = jest.requireActual<typeof import('ulid')>('ulid');
  return { ...actual, ulid: jest.fn(actual.ulid) };
});

describe('SqliteArtifactStore (IArtifactStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runArtifactStoreContractSuite(() => new SqliteArtifactStore(env.db));
});
