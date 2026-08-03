import { SqliteSkillStore } from '../../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { runSkillStoreContractSuite } from '../../skillStoreContractSuite';
import { createSqliteTestDatabase, type SqliteTestDatabase } from '../testDatabase';

describe('SqliteSkillStore (ISkillStore contract)', () => {
  let env: SqliteTestDatabase;

  beforeEach(async () => {
    env = await createSqliteTestDatabase();
  }, 120_000);

  afterEach(async () => {
    await env?.teardown();
  });

  runSkillStoreContractSuite(() => new SqliteSkillStore(env.db));
});
