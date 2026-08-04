import { AgentSpecSchema } from '@truefoundry/utils-core/agent-session';
import { HTTPException } from 'hono/http-exception';
import { TENANT_ID } from '../../../src/apis/sessions';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import { validateAgentSpec } from '../../../src/runtime/sessionResources';

describe('validateAgentSpec sandbox gate', () => {
  async function setup() {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const modelProviderStore = new SqliteModelProviderStore(db);
    await modelProviderStore.upsertProvider({
      tenant_id: TENANT_ID,
      name: 'test-provider',
      manifest: {
        type: 'openai',
        auth: { api_key: 'sk-test' },
        models: [
          {
            model_id: 'test-model',
            name: 'test-model',
            properties: { context_length: 128000, max_output_tokens: 4096 },
          },
        ],
      },
    });
    return {
      modelProviderStore,
      mcpServerStore: new SqliteMcpServerStore(db),
      skillStore: new SqliteSkillStore(db),
      sandboxProviderStore: new SqliteSandboxProviderStore(db),
    };
  }

  it('rejects sandbox.enabled when no sandbox provider is configured', async () => {
    const stores = await setup();
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
          config: { sandbox: { enabled: true } },
        }),
        tenant_id: TENANT_ID,
        ...stores,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('PUT /settings/sandbox-providers'),
    } satisfies Partial<HTTPException>);
  });

  it('rejects skills when no sandbox provider is configured', async () => {
    const stores = await setup();
    await stores.skillStore.upsertSkill({
      tenant_id: TENANT_ID,
      name: 'demo',
      manifest: {
        type: 'git',
        name: 'demo',
        url: 'https://github.com/example/skills',
        ref: 'main',
        description: 'demo skill',
      },
    });

    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
          skills: [{ name: 'demo' }],
        }),
        tenant_id: TENANT_ID,
        ...stores,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('skills require a sandbox provider'),
    } satisfies Partial<HTTPException>);
  });

  it('admits sandbox.enabled when a sandbox provider row exists', async () => {
    const stores = await setup();
    await stores.sandboxProviderStore.upsertSandboxProvider({
      tenant_id: TENANT_ID,
      manifest: {
        type: 'daytona',
        snapshot_name: 'snap',
        auth: { api_key: 'dtn-test' },
        exec_timeout_ms: 60_000,
        auto_stop_interval_in_minutes: 5,
        auto_archive_interval_in_minutes: 60,
        auto_delete_interval_in_minutes: 7200,
      },
    });

    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
          config: { sandbox: { enabled: true } },
        }),
        tenant_id: TENANT_ID,
        ...stores,
      }),
    ).resolves.toBeUndefined();
  });
});
