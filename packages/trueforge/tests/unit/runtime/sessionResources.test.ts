import {
  AgentSpecSchema,
  InMemorySessionStore,
  Sessions,
  type SessionAgent,
  type SessionHandle,
  type SessionMetadata,
} from '@truefoundry/trueforge-core/agent-session';
import { HTTPException } from 'hono/http-exception';
import { validateGitAgentSkills } from '../../../src/db/gitSkillMounts';
import { migrateSqliteToLatest } from '../../../src/db/migrateSqlite';
import type { ISkillStore } from '../../../src/db/skillStore';
import { createSqliteDb } from '../../../src/db/sqlite/client';
import { SqliteMcpServerStore } from '../../../src/db/sqlite/mcp-server-store/SqliteMcpServerStore';
import { SqliteModelProviderStore } from '../../../src/db/sqlite/model-provider-store/SqliteModelProviderStore';
import { SqliteSandboxProviderStore } from '../../../src/db/sqlite/sandbox-provider-store/SqliteSandboxProviderStore';
import { SqliteSkillStore } from '../../../src/db/sqlite/skill-store/SqliteSkillStore';
import {
  buildGatewayMetadata,
  gatewayMetadataHeaders,
  getModelDetails,
  localSandboxSessionSegment,
  TFG_METADATA_PREFIX,
  validateAgentSpec,
  withGatewayMetadataHeaders,
  X_TFY_METADATA,
} from '../../../src/runtime/sessionResources';
import { setCachedLocalSandboxSupport } from '../../../src/sandbox/localRuntime';
import type { ReasoningEffort } from '../../../src/schemas/modelProvider';

async function createGatewayMetadataSession(input: {
  agent: SessionAgent;
  metadata?: SessionMetadata;
}): Promise<SessionHandle> {
  const sessions = new Sessions({ sessionStore: new InMemorySessionStore() });
  return sessions.create({
    tenant_id: 'tenant-1',
    session_id: 'sess-1',
    created_by_subject: { subject_id: 'user-1', subject_type: 'user', subject_display_name: 'user-1' },
    agent: input.agent,
    metadata: input.metadata ?? {},
    external_id: null,
  });
}

describe('buildGatewayMetadata', () => {
  it('stamps session/turn ids and reference agent fields over session metadata', async () => {
    const session = await createGatewayMetadataSession({
      agent: { type: 'reference', id: 'agent-1', name: 'my-agent' },
      metadata: { env: 'dev', [`${TFG_METADATA_PREFIX}.session_id`]: 'caller-override' },
    });

    expect(buildGatewayMetadata({ session, turnId: 'turn-1' })).toEqual({
      env: 'dev',
      [`${TFG_METADATA_PREFIX}.session_id`]: 'sess-1',
      [`${TFG_METADATA_PREFIX}.turn_id`]: 'turn-1',
      [`${TFG_METADATA_PREFIX}.agent_id`]: 'agent-1',
      [`${TFG_METADATA_PREFIX}.agent_name`]: 'my-agent',
    });
  });

  it('omits agent_name when the reference name snapshot is null', async () => {
    const session = await createGatewayMetadataSession({
      agent: { type: 'reference', id: 'agent-legacy', name: null },
    });

    expect(buildGatewayMetadata({ session, turnId: 'turn-2' })).toEqual({
      [`${TFG_METADATA_PREFIX}.session_id`]: 'sess-1',
      [`${TFG_METADATA_PREFIX}.turn_id`]: 'turn-2',
      [`${TFG_METADATA_PREFIX}.agent_id`]: 'agent-legacy',
    });
  });

  it('omits agent keys for inline agents', async () => {
    const session = await createGatewayMetadataSession({
      agent: {
        type: 'inline',
        spec: AgentSpecSchema.parse({ model: { name: 'openai/gpt-4o' } }),
      },
      metadata: { ticket: 'T-1' },
    });

    expect(buildGatewayMetadata({ session, turnId: 'turn-3' })).toEqual({
      ticket: 'T-1',
      [`${TFG_METADATA_PREFIX}.session_id`]: 'sess-1',
      [`${TFG_METADATA_PREFIX}.turn_id`]: 'turn-3',
    });
  });
});

describe('gatewayMetadataHeaders', () => {
  it('stringifies metadata under x-tfy-metadata', () => {
    expect(gatewayMetadataHeaders({ a: '1' })).toEqual({
      [X_TFY_METADATA]: JSON.stringify({ a: '1' }),
    });
    expect(gatewayMetadataHeaders({})).toEqual({});
  });
});

describe('withGatewayMetadataHeaders', () => {
  it('merges into static headers', () => {
    const headers = withGatewayMetadataHeaders({
      headers: { Authorization: 'Bearer t' },
      metadataHeaders: { [X_TFY_METADATA]: '{"k":"v"}' },
    });
    expect(headers).toEqual({
      Authorization: 'Bearer t',
      [X_TFY_METADATA]: '{"k":"v"}',
    });
  });

  it('merges into async header resolvers and preserves authRequired', async () => {
    const withAuth = withGatewayMetadataHeaders({
      headers: async () => ({ headers: { Authorization: 'Bearer t' } }),
      metadataHeaders: { [X_TFY_METADATA]: '{"k":"v"}' },
    });
    expect(typeof withAuth).toBe('function');
    if (typeof withAuth !== 'function') {
      throw new Error('expected async header resolver');
    }
    await expect(withAuth()).resolves.toEqual({
      headers: {
        Authorization: 'Bearer t',
        [X_TFY_METADATA]: '{"k":"v"}',
      },
    });

    const authRequired = withGatewayMetadataHeaders({
      headers: async () => ({
        authRequired: { servers: [{ id: 'mcp', name: 'mcp', auth_url: 'https://auth.example' }] },
      }),
      metadataHeaders: { [X_TFY_METADATA]: '{"k":"v"}' },
    });
    expect(typeof authRequired).toBe('function');
    if (typeof authRequired !== 'function') {
      throw new Error('expected async header resolver');
    }
    await expect(authRequired()).resolves.toEqual({
      authRequired: { servers: [{ id: 'mcp', name: 'mcp', auth_url: 'https://auth.example' }] },
    });
  });

  it('returns the original headers when metadata is empty', () => {
    const staticHeaders = { Authorization: 'Bearer t' };
    expect(withGatewayMetadataHeaders({ headers: staticHeaders, metadataHeaders: {} })).toBe(staticHeaders);
  });
});

describe('localSandboxSessionSegment', () => {
  it('keeps a single-segment session id and rejects missing or unsafe values', () => {
    expect(localSandboxSessionSegment('sess_1')).toBe('sess_1');
    expect(localSandboxSessionSegment(undefined)).toBe('_');
    expect(localSandboxSessionSegment('')).toBe('_');
    expect(localSandboxSessionSegment('a/b')).toBe('_');
    expect(localSandboxSessionSegment('..')).toBe('_');
    expect(localSandboxSessionSegment('foo..bar')).toBe('_');
  });
});

describe('validateAgentSpec', () => {
  afterEach(() => {
    setCachedLocalSandboxSupport(undefined);
  });

  async function setup(options?: { reasoningEfforts?: ReasoningEffort[] | undefined }) {
    const db = createSqliteDb(':memory:');
    await migrateSqliteToLatest(db);
    const modelProviderStore = new SqliteModelProviderStore(db);
    await modelProviderStore.upsertProvider({
      tenant_id: 'default',
      name: 'test-provider',
      manifest: {
        // Caller-named, so `custom` is the only type it can be.
        type: 'custom',
        name: 'test-provider',
        base_url: 'https://llm.test.example.com/v1',
        auth: { api_key: 'sk-test' },
        models: [
          {
            model_id: 'test-model',
            name: 'test-model',
            properties: {
              context_length: 128000,
              max_output_tokens: 4096,
              ...(options?.reasoningEfforts !== undefined ? { reasoning_efforts: options.reasoningEfforts } : {}),
            },
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

  it('maps the configured model output limit to runtime max_tokens', async () => {
    const stores = await setup();

    await expect(
      getModelDetails({
        tenant_id: 'default',
        name: 'test-provider/test-model',
        store: stores.modelProviderStore,
      }),
    ).resolves.toMatchObject({
      providerConfig: {
        provider: { type: 'custom', name: 'test-provider' },
        model: { id: 'test-model', name: 'test-model' },
        name: 'test-provider/test-model',
      },
      defaultModelParams: { max_tokens: 4096 },
      modelProperties: { contextLength: 128000 },
    });
  });

  it('rejects malformed model FQN with 422', async () => {
    const stores = await setup();
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'not-a-fqn' },
          instructions: 'test',
        }),
        tenant_id: 'default',
        ...stores,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('fully qualified "provider/model"'),
    } satisfies Partial<HTTPException>);
  });

  it('rejects unknown model provider with 422', async () => {
    const stores = await setup();
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'missing-provider/test-model' },
          instructions: 'test',
        }),
        tenant_id: 'default',
        ...stores,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('provider not configured'),
    } satisfies Partial<HTTPException>);
  });

  it('rejects unknown model on provider with 422', async () => {
    const stores = await setup();
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/missing-model' },
          instructions: 'test',
        }),
        tenant_id: 'default',
        ...stores,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('not configured on provider'),
    } satisfies Partial<HTTPException>);
  });

  it('rejects unsupported reasoning effort with 422', async () => {
    const stores = await setup({ reasoningEfforts: ['low', 'high'] });
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model', params: { reasoning_effort: 'medium' } },
          instructions: 'test',
        }),
        tenant_id: 'default',
        ...stores,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Reasoning effort "medium"'),
    } satisfies Partial<HTTPException>);
  });

  it('rejects unknown MCP server with 422', async () => {
    const stores = await setup();
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
          mcp_servers: [{ name: 'missing-mcp' }],
        }),
        tenant_id: 'default',
        ...stores,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Unknown MCP server "missing-mcp"'),
    } satisfies Partial<HTTPException>);
  });

  it('rejects unknown skill with 422', async () => {
    const stores = await setup();
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
          skills: [{ name: 'missing-skill' }],
        }),
        tenant_id: 'default',
        ...stores,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: expect.stringContaining('Unknown skill "missing-skill"'),
    } satisfies Partial<HTTPException>);
  });

  it('rejects sandbox.enabled when no sandbox provider is configured', async () => {
    const stores = await setup();
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
          config: { sandbox: { enabled: true } },
        }),
        tenant_id: 'default',
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
      tenant_id: 'default',
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
        tenant_id: 'default',
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
      tenant_id: 'default',
      manifest: {
        type: 'daytona',
        auth: { api_key: 'dtn-test' },
        exec_timeout_ms: 60_000,
        auto_stop_interval_in_minutes: 5,
        auto_archive_interval_in_minutes: 60,
        auto_delete_interval_in_minutes: 7200,
      },
      status: 'pending',
      status_reason: 'Sandbox image build started.',
      build_metadata: { build_ref: 'trueforge-build-029ea5ff', image_uri: 'tfy.jfrog.io/tfy-images/sandbox:029ea5ff' },
    });

    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
          config: { sandbox: { enabled: true } },
        }),
        tenant_id: 'default',
        ...stores,
      }),
    ).resolves.toBeUndefined();
  });

  it('admits sandbox.enabled when local fallback is cached and the store is empty', async () => {
    const stores = await setup();
    setCachedLocalSandboxSupport({
      supported: true,
      platform: 'darwin',
      shell: '/bin/bash',
      python: '/usr/bin/python3',
    });
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
          config: { sandbox: { enabled: true } },
        }),
        tenant_id: 'default',
        ...stores,
      }),
    ).resolves.toBeUndefined();
    expect(await stores.sandboxProviderStore.getSandboxProvider('default')).toBeUndefined();
  });

  it('rejects registry catalog rows as git mounts (standalone)', async () => {
    const stores = await setup();
    setCachedLocalSandboxSupport({
      supported: true,
      platform: 'darwin',
      shell: '/bin/bash',
      python: '/usr/bin/python3',
    });
    const fqn = 'agent-skill:acme/team-a/echo:1';
    const now = '2026-01-01T00:00:00.000Z';
    const skillStore: ISkillStore = {
      listSkills: async () => [
        {
          tenant_id: 'default',
          name: fqn,
          manifest: {
            type: 'truefoundry' as const,
            name: fqn,
            display_name: 'echo',
            description: 'Echo',
            repository_name: 'team-a',
            version: 1,
          },
          created_at: now,
          updated_at: now,
        },
      ],
      createSkill: async () => {
        throw new Error('unused');
      },
      upsertSkill: async () => {
        throw new Error('unused');
      },
      listSkillVersions: async () => [],
      async validateAgentSkills(input) {
        return validateGitAgentSkills(this, input);
      },
      resolveTurnSkills: async () => {
        throw new Error('unused');
      },
    };
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
          skills: [{ name: fqn }],
        }),
        tenant_id: 'default',
        ...stores,
        skillStore,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: `Skill "${fqn}" is not a git skill`,
    });
  });

  it('validates skills via skillStore.validateAgentSkills', async () => {
    const stores = await setup();
    setCachedLocalSandboxSupport({
      supported: true,
      platform: 'darwin',
      shell: '/bin/bash',
      python: '/usr/bin/python3',
    });
    const validateAgentSkills = jest.spyOn(stores.skillStore, 'validateAgentSkills').mockResolvedValue(undefined);
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
          skills: [{ name: 'agent-skill:acme/team-a/echo:3', preload: false }],
        }),
        tenant_id: 'default',
        ...stores,
      }),
    ).resolves.toBeUndefined();
    expect(validateAgentSkills).toHaveBeenCalledWith({
      tenant_id: 'default',
      skills: [{ name: 'agent-skill:acme/team-a/echo:3', preload: false }],
    });
  });

  it('rejects preload on git skills', async () => {
    const stores = await setup();
    setCachedLocalSandboxSupport({
      supported: true,
      platform: 'darwin',
      shell: '/bin/bash',
      python: '/usr/bin/python3',
    });
    await stores.skillStore.upsertSkill({
      tenant_id: 'default',
      name: 'echo',
      manifest: {
        type: 'git',
        name: 'echo',
        description: 'Echo',
        url: 'https://github.com/acme/skills',
        ref: 'main',
      },
    });
    await expect(
      validateAgentSpec({
        spec: AgentSpecSchema.parse({
          model: { name: 'test-provider/test-model' },
          instructions: 'test',
          skills: [{ name: 'echo', preload: true }],
        }),
        tenant_id: 'default',
        ...stores,
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: 'Skill "echo": preload is not supported for git skills',
    });
  });
});
