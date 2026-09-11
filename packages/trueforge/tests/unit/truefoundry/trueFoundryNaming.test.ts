/**
 * TrueFoundry-mode naming: agent identity uses NameSchema; fetched skills/MCP/models
 * and AgentSpec refs may use FQNs / longer SVC names that are not ResourceName.
 */
import { AgentSpecSchema } from '@truefoundry/trueforge-core/agent-session';
import { createLogger } from 'winston';
import { CreateAgentRequestSchema, UpdateAgentRequestSchema } from '../../../src/schemas/agent';
import { NameSchema } from '../../../src/schemas/common';
import {
  AvailableMcpServerSchema,
  ConfiguredMcpServerSchema,
  McpServerManifestSchema,
} from '../../../src/schemas/mcpServer';
import { AvailableModelSchema } from '../../../src/schemas/modelProvider';
import { ConfiguredSkillSchema, SkillManifestSchema, SkillVersionSchema } from '../../../src/schemas/skill';
import { createTrueFoundryRequestContext } from '../../../src/truefoundry/accessToken';
import { mapEnabledModels } from '../../../src/truefoundry/mapEnabledModels';
import { mapSfyRegistrySkills } from '../../../src/truefoundry/mapSfyAgentSkills';
import { MCP_PROXY_BASE_URL_TEMPLATE, toTrueFoundryMcpManifest } from '../../../src/truefoundry/mapSfyMcpServers';
import { TrueFoundryMcpServerStore } from '../../../src/truefoundry/TrueFoundryMcpServerStore';
import { TrueFoundrySkillStore } from '../../../src/truefoundry/TrueFoundrySkillStore';

const SKILL_FQN = 'agent-skill:acme/team_a/my.echo:3';
const LONG_MCP_NAME = `a${'b'.repeat(71)}`; // 72 chars — within SVC 3–73, outside NameSchema max 64
const MODEL_FQN = 'openai/gpt-5.2';
const PROVIDER_ACCOUNT = 'my.custom_provider';
const MODEL_NAME = 'model.with.dots';

const requestContext = createTrueFoundryRequestContext({
  tenant_id: 'default',
  subject: { id: 'user-1', type: 'user', display_name: 'user-1' },
  roles: [],
  user_credential: 'token',
});

describe('TrueFoundry naming vs NameSchema', () => {
  it('treats skill FQNs, long MCP names, and model FQNs as non-NameSchema', () => {
    expect(NameSchema.safeParse(SKILL_FQN).success).toBe(false);
    expect(NameSchema.safeParse(LONG_MCP_NAME).success).toBe(false);
    expect(NameSchema.safeParse(MODEL_FQN).success).toBe(false);
    expect(LONG_MCP_NAME).toHaveLength(72);
  });

  it('saves and updates agent manifests that reference TFY skill FQN, long MCP name, and model FQN', () => {
    const body = CreateAgentRequestSchema.parse({
      name: 'support-bot',
      manifest: {
        model: { name: MODEL_FQN },
        mcp_servers: [{ name: LONG_MCP_NAME }],
        skills: [{ name: SKILL_FQN, preload: false }],
      },
    });
    expect(body.name).toBe('support-bot');
    expect(NameSchema.safeParse(body.name).success).toBe(true);
    expect(body.manifest.model.name).toBe(MODEL_FQN);
    expect(body.manifest.mcp_servers?.[0]?.name).toBe(LONG_MCP_NAME);
    expect(body.manifest.skills?.[0]?.name).toBe(SKILL_FQN);

    expect(
      CreateAgentRequestSchema.safeParse({
        name: SKILL_FQN,
        manifest: { model: { name: MODEL_FQN } },
      }).success,
    ).toBe(false);
    expect(
      CreateAgentRequestSchema.safeParse({
        name: 'my.agent',
        manifest: { model: { name: MODEL_FQN } },
      }).success,
    ).toBe(false);

    const updated = UpdateAgentRequestSchema.parse({
      manifest: {
        model: { name: 'custom.provider/my_model.v1' },
        mcp_servers: [{ name: LONG_MCP_NAME }],
        skills: [{ name: SKILL_FQN, preload: true }],
      },
    });
    expect(updated.manifest.model.name).toBe('custom.provider/my_model.v1');
    expect(updated.manifest.skills?.[0]?.name).toBe(SKILL_FQN);
  });

  it('AgentSpecSchema alone accepts the same non-NameSchema refs', () => {
    const spec = AgentSpecSchema.parse({
      model: { name: 'custom.provider/my_model.v1' },
      mcp_servers: [{ name: LONG_MCP_NAME }, { name: 'svc.mcp_with.dots' }],
      skills: [{ name: SKILL_FQN }, { name: 'agent-skill:org/repo.with.dots/skill_name:12' }],
    });
    expect(spec.model.name).toBe('custom.provider/my_model.v1');
    expect(spec.mcp_servers?.map(s => s.name)).toEqual([LONG_MCP_NAME, 'svc.mcp_with.dots']);
    expect(spec.skills?.map(s => s.name)).toEqual([SKILL_FQN, 'agent-skill:org/repo.with.dots/skill_name:12']);
  });

  it('skill list/version wire schemas accept registry FQNs (not NameSchema)', () => {
    expect(
      SkillManifestSchema.parse({
        type: 'truefoundry',
        name: SKILL_FQN,
        display_name: 'my.echo',
        description: 'Echo from registry.',
        repository_name: 'team_a',
        version: 3,
      }).name,
    ).toBe(SKILL_FQN);

    expect(
      ConfiguredSkillSchema.parse({
        name: SKILL_FQN,
        manifest: {
          type: 'truefoundry',
          name: SKILL_FQN,
          display_name: 'my.echo',
          description: 'Echo from registry.',
          repository_name: 'team_a',
          version: 3,
        },
      }).name,
    ).toBe(SKILL_FQN);

    expect(
      SkillVersionSchema.parse({
        name: SKILL_FQN,
        display_name: 'my.echo',
        description: 'v3',
        version: 3,
      }).name,
    ).toBe(SKILL_FQN);

    expect(
      mapSfyRegistrySkills([
        {
          id: 'skill-1',
          fqn: 'agent-skill:acme/team_a/my.echo',
          name: 'my.echo',
          latest_version: {
            id: 'ver-1',
            fqn: SKILL_FQN,
            manifest: {
              name: 'my.echo',
              type: 'agent-skill',
              version: 3,
              ml_repo: 'team_a',
              source: { type: 'blob-storage', description: 'Echo' },
            },
          },
        },
      ])[0]?.name,
    ).toBe(SKILL_FQN);
  });

  it('lists and validates skills by registry FQN without NameSchema', async () => {
    const client = {
      listAgentSkills: jest.fn().mockResolvedValue([
        {
          id: 'skill-1',
          fqn: 'agent-skill:acme/team_a/my.echo',
          name: 'my.echo',
          latest_version: {
            id: 'ver-1',
            fqn: SKILL_FQN,
            manifest: {
              name: 'my.echo',
              type: 'agent-skill',
              version: 3,
              ml_repo: 'team_a',
              source: { type: 'blob-storage', description: 'Echo' },
            },
          },
        },
      ]),
      listAgentSkillVersions: jest.fn(),
      resolveAgentSkillVersions: jest
        .fn()
        .mockResolvedValue([{ fqn: SKILL_FQN, name: 'my.echo', description: 'Echo' }]),
      apiKey: 'tfy-api-key',
    };
    const store = new TrueFoundrySkillStore({ client, context: requestContext });

    const listed = await store.listSkills({ tenant_id: 'default', names: undefined });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe(SKILL_FQN);
    expect(NameSchema.safeParse(listed[0]?.name).success).toBe(false);

    await expect(
      store.validateAgentSkills({
        tenant_id: 'default',
        skills: [{ name: SKILL_FQN, preload: false }],
      }),
    ).resolves.toBeUndefined();
    expect(client.resolveAgentSkillVersions).toHaveBeenCalledWith({
      accessToken: 'token',
      skills: [{ fqn: SKILL_FQN }],
    });
  });

  it('maps SVC MCP rows with long / dotted names without NameSchema.parse', () => {
    const dotted = 'org.team_mcp.server';
    expect(NameSchema.safeParse(dotted).success).toBe(false);

    const longManifest = toTrueFoundryMcpManifest({
      server: {
        id: 'mcp-long',
        name: LONG_MCP_NAME,
        proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/mcp-server/${LONG_MCP_NAME}`,
        description: 'Long SVC name',
        authType: 'oauth2',
        createdAt: '2026-01-15T12:00:00.000Z',
        updatedAt: '2026-01-16T12:00:00.000Z',
      },
      gatewayUrl: 'https://gateway.example',
    });
    expect(longManifest.name).toBe(LONG_MCP_NAME);
    expect(longManifest.name).toHaveLength(72);
    // Documented OpenAPI type is stricter than runtime TFY mapping.
    expect(McpServerManifestSchema.safeParse(longManifest).success).toBe(false);
    expect(
      AvailableMcpServerSchema.safeParse({
        name: LONG_MCP_NAME,
        url: longManifest.url,
        auth_status: { status: 'not_required' },
      }).success,
    ).toBe(false);
    expect(
      ConfiguredMcpServerSchema.safeParse({
        name: LONG_MCP_NAME,
        manifest: longManifest,
        auth_status: { status: 'not_required' },
      }).success,
    ).toBe(false);

    const dottedManifest = toTrueFoundryMcpManifest({
      server: {
        id: 'mcp-dotted',
        name: dotted,
        proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/mcp-server/${dotted}`,
        description: 'Dotted SVC name',
        authType: undefined,
        createdAt: '2026-01-15T12:00:00.000Z',
        updatedAt: '2026-01-16T12:00:00.000Z',
      },
      gatewayUrl: 'https://gateway.example',
    });
    expect(dottedManifest.name).toBe(dotted);
  });

  it('lists long-named MCP servers from SFY without throwing', async () => {
    const row = {
      id: 'mcp-long',
      name: LONG_MCP_NAME,
      proxyUrl: `${MCP_PROXY_BASE_URL_TEMPLATE}/mcp-server/${LONG_MCP_NAME}`,
      createdAt: '2026-01-15T12:00:00.000Z',
      updatedAt: '2026-01-16T12:00:00.000Z',
      manifest: { description: 'Long', auth_data: { type: 'oauth2' } },
    };
    const client = {
      getMcpServerByName: jest.fn().mockResolvedValue(row),
      listMcpServers: jest.fn().mockResolvedValue([row]),
      listGatewayInstallations: jest
        .fn()
        .mockResolvedValue([{ isDefault: true, manifest: { url: 'https://gateway.example' } }]),
      getMcpAuthorize: jest.fn(),
      getMcpAuthStatus: jest.fn().mockResolvedValue({ status: 'authenticated' }),
      deleteMcpAuth: jest.fn(),
      vendToken: jest.fn(),
    };
    const store = new TrueFoundryMcpServerStore({
      client,
      requestContext,
      agent: undefined,
      logger: createLogger({ silent: true }),
    });

    const listed = await store.listServers({ tenant_id: 'default', names: undefined });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.name).toBe(LONG_MCP_NAME);
    expect(listed[0]?.manifest.name).toBe(LONG_MCP_NAME);

    const got = await store.getServer({ tenant_id: 'default', name: LONG_MCP_NAME });
    expect(got?.name).toBe(LONG_MCP_NAME);
  });

  it('available model wire schema accepts provider/model FQNs outside NameSchema', () => {
    expect(
      AvailableModelSchema.parse({
        name: MODEL_FQN,
        model_id: 'gpt-5.2',
        provider: { name: 'openai' },
        properties: {},
      }).name,
    ).toBe(MODEL_FQN);
    expect(
      AvailableModelSchema.parse({
        name: `${PROVIDER_ACCOUNT}/${MODEL_NAME}`,
        model_id: 'upstream/id.with.dots',
        provider: { name: PROVIDER_ACCOUNT },
        properties: {},
      }).provider.name,
    ).toBe(PROVIDER_ACCOUNT);
  });

  it('maps SFY model integrations with dotted provider/model names without NameSchema', () => {
    const models = mapEnabledModels({
      integrations: [
        {
          name: MODEL_NAME,
          manifest: { model_types: ['chat'] },
          providerAccount: { name: PROVIDER_ACCOUNT },
          metadata: {},
        },
      ],
    });
    expect(models).toEqual([{ accountName: PROVIDER_ACCOUNT, modelName: MODEL_NAME, properties: {} }]);
    const fqn = `${models[0]?.accountName}/${models[0]?.modelName}`;
    expect(fqn).toBe(`${PROVIDER_ACCOUNT}/${MODEL_NAME}`);
    expect(NameSchema.safeParse(fqn).success).toBe(false);
    expect(NameSchema.safeParse(PROVIDER_ACCOUNT).success).toBe(false);
    expect(NameSchema.safeParse(MODEL_NAME).success).toBe(false);
  });
});
