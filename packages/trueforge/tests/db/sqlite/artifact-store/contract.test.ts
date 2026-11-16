import { SqliteArtifactStore } from '../../../../src/db/sqlite/artifact-store/SqliteArtifactStore';
import { runArtifactStoreContractSuite } from '../../artifactStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteArtifactStore', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runArtifactStoreContractSuite(() => new SqliteArtifactStore(env.db));
});
