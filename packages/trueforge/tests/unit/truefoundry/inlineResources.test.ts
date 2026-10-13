import { HTTPException } from 'hono/http-exception';
import type { IMcpServerWithAuthStore, McpServerRecord } from '../../../src/db/mcpServerStore';
import type { IModelProviderStore, ModelProviderRecord } from '../../../src/db/modelProviderStore';
import type { ISkillStore, SkillRecord } from '../../../src/db/skillStore';
import { TFG_METADATA_PREFIX, X_TFY_METADATA } from '../../../src/truefoundry/gatewayMetadata';
import { InlineMcpServerStore } from '../../../src/truefoundry/InlineMcpServerStore';
import { InlineModelProviderStore } from '../../../src/truefoundry/InlineModelProviderStore';
import {
  parseInlineMcpServers,
  parseInlineModelProviders,
  parseInlineSkills,
} from '../../../src/truefoundry/inlineResources';
import { InlineSkillStore } from '../../../src/truefoundry/InlineSkillStore';

const DOCS_MCP = {
  url: 'https://docs.example/mcp',
  description: 'Search the product documentation.',
  auth: { type: 'header', headers: { Authorization: 'Bearer saas-token' } },
};

const ASK_AI_SKILL = {
  url: 'https://github.com/truefoundry/skills',
  ref: 'a1b2c3d',
  path: 'ask-ai',
  description: 'How to answer questions about the platform.',
};

const GATEWAY_PROVIDER = {
  base_url: 'https://gateway.example/api/inference/openai',
  auth: { api_key: 'rotating-token' },
  models: [{ model_id: 'openai-main/gpt-5', name: 'gpt-5', properties: { context_length: 200000 } }],
};

const registryServer: McpServerRecord = {
  id: '01JREGISTRY',
  tenant_id: 'default',
  name: 'team-mcp',
  manifest: { type: 'remote', name: 'team-mcp', url: 'https://team.example/mcp', description: 'Team server.' },
  created_at: '2026-01-15T12:00:00.000Z',
  updated_at: '2026-01-15T12:00:00.000Z',
};

const registrySkill: SkillRecord = {
  tenant_id: 'default',
  name: 'team-skill',
  manifest: {
    type: 'git',
    name: 'team-skill',
    url: 'https://github.com/acme/skills',
    ref: 'main',
    description: 'A skill the tenant configured.',
  },
  created_at: '2026-01-15T12:00:00.000Z',
  updated_at: '2026-01-15T12:00:00.000Z',
};

const registryProvider: ModelProviderRecord = {
  tenant_id: 'default',
  name: 'openai',
  manifest: {
    type: 'openai',
    base_url: 'https://api.openai.com/v1',
    auth: { api_key: 'stored-key' },
    models: [{ model_id: 'gpt-5', name: 'gpt-5', properties: {} }],
  },
  created_at: '2026-01-15T12:00:00.000Z',
  updated_at: '2026-01-15T12:00:00.000Z',
};

function modelProviderStoreWith(inlineRaw: object) {
  const inner = {
    listProviders: jest.fn().mockResolvedValue([registryProvider]),
    getProvider: jest.fn().mockResolvedValue(registryProvider),
    listModels: jest.fn().mockResolvedValue([]),
    resolveInvokeHeaders: jest.fn().mockResolvedValue({ Authorization: 'Bearer caller-token' }),
  } as unknown as IModelProviderStore;
  const store = new InlineModelProviderStore({
    inner,
    inline: parseInlineModelProviders(JSON.stringify(inlineRaw)),
  });
  return { store, inner };
}

function mcpStoreWith(inlineRaw: object) {
  const inner = {
    getServer: jest.fn().mockResolvedValue(registryServer),
    listServers: jest.fn().mockResolvedValue([registryServer]),
    resolveInvokeHeaders: jest.fn().mockReturnValue({ Authorization: 'Bearer caller-token' }),
    resolveAuthStatuses: jest.fn().mockResolvedValue(new Map([['team-mcp', { status: 'not_required' }]])),
  } as unknown as IMcpServerWithAuthStore;
  const store = new InlineMcpServerStore({
    inner,
    inline: parseInlineMcpServers(JSON.stringify(inlineRaw)),
  });
  return { store, inner };
}

function skillStoreWith(inlineRaw: object, innerOverrides?: Partial<ISkillStore>) {
  const inner = {
    listSkills: jest.fn().mockResolvedValue([registrySkill]),
    validateAgentSkills: jest.fn().mockResolvedValue(undefined),
    resolveTurnSkills: jest.fn().mockResolvedValue([]),
    listSkillVersions: jest.fn().mockResolvedValue([]),
    ...innerOverrides,
  } as unknown as ISkillStore;
  const store = new InlineSkillStore({ inner, inline: parseInlineSkills(JSON.stringify(inlineRaw)) });
  return { store, inner };
}

describe('parseInlineMcpServers', () => {
  it('fills in the type and the name the caller left implicit', () => {
    expect(parseInlineMcpServers(JSON.stringify({ 'docs-mcp': DOCS_MCP }))).toEqual({
      'docs-mcp': { ...DOCS_MCP, type: 'remote', name: 'docs-mcp' },
    });
  });

  it('rejects dcr auth, which has no registered client or stored token to use', () => {
    const raw = JSON.stringify({ 'docs-mcp': { ...DOCS_MCP, auth: { type: 'dcr' } } });

    expect(() => parseInlineMcpServers(raw)).toThrow(HTTPException);
  });

  it.each([
    ['not json', 'not-json'],
    ['an array', '[]'],
    ['a scalar', '"nope"'],
    ['a server mapped to a string', JSON.stringify({ 'docs-mcp': 'https://docs.example/mcp' })],
    ['a server with no url', JSON.stringify({ 'docs-mcp': { description: 'no url' } })],
    ['a name the registry would reject', JSON.stringify({ 'Docs MCP': DOCS_MCP })],
    ['an unknown field', JSON.stringify({ 'docs-mcp': { ...DOCS_MCP, preload: true } })],
  ])('rejects %s rather than falling back to a registry that has no such server', (_case, raw) => {
    expect(() => parseInlineMcpServers(raw)).toThrow(HTTPException);
  });

  it('keeps the parse failure as the cause, so a bad header can be debugged', () => {
    expect(() => parseInlineMcpServers('not-json')).toThrow(
      expect.objectContaining({ cause: expect.any(SyntaxError) }),
    );
  });
});

describe('parseInlineSkills', () => {
  it('fills in the type and the name the caller left implicit', () => {
    expect(parseInlineSkills(JSON.stringify({ 'ask-ai': ASK_AI_SKILL }))).toEqual({
      'ask-ai': { ...ASK_AI_SKILL, type: 'git', name: 'ask-ai' },
    });
  });

  it.each([
    ['no ref, which would silently mount a moving HEAD', { url: ASK_AI_SKILL.url, description: 'no ref' }],
    ['a non-git host', { ...ASK_AI_SKILL, url: 'https://example.com/skills' }],
    ['a path escaping the repository', { ...ASK_AI_SKILL, path: '../secrets' }],
  ])('rejects a skill with %s', (_case, definition) => {
    expect(() => parseInlineSkills(JSON.stringify({ 'ask-ai': definition }))).toThrow(HTTPException);
  });
});

describe('parseInlineModelProviders', () => {
  it('maps each entry onto a custom provider named by its key', () => {
    expect(parseInlineModelProviders(JSON.stringify({ 'tfy-gateway': GATEWAY_PROVIDER }))).toEqual({
      'tfy-gateway': { ...GATEWAY_PROVIDER, type: 'custom', name: 'tfy-gateway' },
    });
  });

  it('accepts a provider that carries no credentials', () => {
    const { auth: _auth, ...withoutAuth } = GATEWAY_PROVIDER;

    expect(parseInlineModelProviders(JSON.stringify({ 'tfy-gateway': withoutAuth }))).toEqual({
      'tfy-gateway': { ...withoutAuth, type: 'custom', name: 'tfy-gateway' },
    });
  });

  it.each([
    ['no base_url', { auth: GATEWAY_PROVIDER.auth, models: GATEWAY_PROVIDER.models }],
    ['no models', { ...GATEWAY_PROVIDER, models: [] }],
    [
      'a model name the FQN parser would split',
      { ...GATEWAY_PROVIDER, models: [{ model_id: 'x', name: 'a/b', properties: {} }] },
    ],
    [
      'two models sharing a name',
      {
        ...GATEWAY_PROVIDER,
        models: [...GATEWAY_PROVIDER.models, { ...GATEWAY_PROVIDER.models[0], model_id: 'other' }],
      },
    ],
  ])(
    'rejects a provider with %s rather than falling back to a registry that has no such provider',
    (_case, definition) => {
      expect(() => parseInlineModelProviders(JSON.stringify({ 'tfy-gateway': definition }))).toThrow(HTTPException);
    },
  );
});

describe('InlineModelProviderStore', () => {
  it('resolves an inline provider by name without asking the registry', async () => {
    const { store, inner } = modelProviderStoreWith({ 'tfy-gateway': GATEWAY_PROVIDER });

    const record = await store.getProvider({ tenant_id: 'default', name: 'tfy-gateway', model_name: 'gpt-5' });

    expect(record?.name).toBe('tfy-gateway');
    expect(record?.manifest).toEqual({ ...GATEWAY_PROVIDER, type: 'custom', name: 'tfy-gateway' });
    expect(inner.getProvider).not.toHaveBeenCalled();
  });

  it('falls through to the registry for a provider the request did not bring', async () => {
    const { store } = modelProviderStoreWith({ 'tfy-gateway': GATEWAY_PROVIDER });

    expect(await store.getProvider({ tenant_id: 'default', name: 'openai', model_name: 'gpt-5' })).toEqual(
      registryProvider,
    );
  });

  it('does not treat Object.prototype keys as inline resources', async () => {
    const { store, inner } = modelProviderStoreWith({ 'tfy-gateway': GATEWAY_PROVIDER });

    await store.getProvider({ tenant_id: 'default', name: 'constructor', model_name: 'gpt-5' });

    expect(inner.getProvider).toHaveBeenCalledWith(
      { tenant_id: 'default', name: 'constructor', model_name: 'gpt-5' },
      undefined,
    );
  });

  it('keeps request-scoped providers out of settings and the model picker', async () => {
    const { store } = modelProviderStoreWith({ 'tfy-gateway': GATEWAY_PROVIDER });

    const providers = await store.listProviders({ tenant_id: 'default' });
    const models = await store.listModels({ tenant_id: 'default' });

    expect(providers.map(record => record.name)).toEqual(['openai']);
    expect(models).toEqual([]);
  });

  it('adds only x-tfy-metadata on inline invokes, since the manifest already carries the api_key', async () => {
    const { store, inner } = modelProviderStoreWith({ 'tfy-gateway': GATEWAY_PROVIDER });
    const record = { ...registryProvider, name: 'tfy-gateway' };

    const headers = await store.resolveInvokeHeaders({
      record,
      turnMetadata: {
        sessionId: 'sess-1',
        turnId: 'turn-1',
        agent: { id: 'agent-1', name: 'named' },
        requestHeaders: { 'x-tfy-metadata': JSON.stringify({ env: 'prod' }) },
      },
    });

    expect(Object.keys(headers)).toEqual([X_TFY_METADATA]);
    expect(JSON.parse(headers[X_TFY_METADATA] ?? '')).toMatchObject({
      env: 'prod',
      [`${TFG_METADATA_PREFIX}.session_id`]: 'sess-1',
      [`${TFG_METADATA_PREFIX}.turn_id`]: 'turn-1',
      [`${TFG_METADATA_PREFIX}.agent_id`]: 'agent-1',
      [`${TFG_METADATA_PREFIX}.agent_name`]: 'named',
    });
    expect(inner.resolveInvokeHeaders).not.toHaveBeenCalled();
  });

  it('leaves a registry provider to the store that knows how to authenticate it', async () => {
    const { store, inner } = modelProviderStoreWith({ 'tfy-gateway': GATEWAY_PROVIDER });

    expect(await store.resolveInvokeHeaders({ record: registryProvider })).toEqual({
      Authorization: 'Bearer caller-token',
    });
    expect(inner.resolveInvokeHeaders).toHaveBeenCalled();
  });
});

describe('InlineMcpServerStore', () => {
  it('sends the credentials the manifest carries, with no caller Bearer added over them', () => {
    const { store } = mcpStoreWith({ 'docs-mcp': DOCS_MCP });
    const record = { ...registryServer, name: 'docs-mcp' };

    expect(store.resolveInvokeHeaders({ record, userRef: 'user-1' })).toEqual({
      Authorization: 'Bearer saas-token',
    });
  });

  it('stamps x-tfy-metadata on inline invokes when turnMetadata is present', () => {
    const { store } = mcpStoreWith({ 'docs-mcp': DOCS_MCP });
    const record = { ...registryServer, name: 'docs-mcp' };

    const headers = store.resolveInvokeHeaders({
      record,
      userRef: 'user-1',
      turnMetadata: {
        sessionId: 'sess-1',
        turnId: 'turn-1',
        agent: { id: 'agent-1', name: 'named' },
        requestHeaders: { 'x-tfy-metadata': JSON.stringify({ env: 'prod' }) },
      },
    });

    expect(headers).toEqual({
      Authorization: 'Bearer saas-token',
      [X_TFY_METADATA]: expect.any(String),
    });
    expect(JSON.parse((headers as Record<string, string>)[X_TFY_METADATA] ?? '')).toMatchObject({
      env: 'prod',
      [`${TFG_METADATA_PREFIX}.session_id`]: 'sess-1',
      [`${TFG_METADATA_PREFIX}.turn_id`]: 'turn-1',
      [`${TFG_METADATA_PREFIX}.agent_id`]: 'agent-1',
      [`${TFG_METADATA_PREFIX}.agent_name`]: 'named',
    });
  });

  it('leaves a registry server to the store that knows how to authenticate it', () => {
    const { store, inner } = mcpStoreWith({ 'docs-mcp': DOCS_MCP });

    expect(store.resolveInvokeHeaders({ record: registryServer, userRef: 'user-1' })).toEqual({
      Authorization: 'Bearer caller-token',
    });
    expect(inner.resolveInvokeHeaders).toHaveBeenCalled();
  });

  it('resolves an inline server by name without asking the registry', async () => {
    const { store, inner } = mcpStoreWith({ 'docs-mcp': DOCS_MCP });

    const record = await store.getServer({ tenant_id: 'default', name: 'docs-mcp' });

    expect(record?.manifest.url).toBe(DOCS_MCP.url);
    expect(inner.getServer).not.toHaveBeenCalled();
  });

  it('falls through to the registry for a name the request did not bring', async () => {
    const { store } = mcpStoreWith({ 'docs-mcp': DOCS_MCP });

    expect(await store.getServer({ tenant_id: 'default', name: 'team-mcp' })).toEqual(registryServer);
  });

  it('does not treat Object.prototype keys as inline resources', async () => {
    const { store, inner } = mcpStoreWith({ 'docs-mcp': DOCS_MCP });

    await store.getServer({ tenant_id: 'default', name: 'constructor' });

    expect(inner.getServer).toHaveBeenCalledWith({ tenant_id: 'default', name: 'constructor' }, undefined);
  });

  it('answers a name-filtered list from both sources, which is what spec validation asks for', async () => {
    const { store } = mcpStoreWith({ 'docs-mcp': DOCS_MCP });

    const data = await store.listServers({
      tenant_id: 'default',
      names: ['docs-mcp', 'team-mcp'],
    });

    expect(data.map(record => record.name)).toEqual(['docs-mcp', 'team-mcp']);
  });

  it('keeps request-scoped servers out of an unfiltered list, so they never reach tenant settings', async () => {
    const { store } = mcpStoreWith({ 'docs-mcp': DOCS_MCP });

    const data = await store.listServers({
      tenant_id: 'default',
      names: undefined,
    });

    expect(data.map(record => record.name)).toEqual(['team-mcp']);
  });
});

describe('InlineSkillStore', () => {
  it('answers a name-filtered list from both sources', async () => {
    const { store } = skillStoreWith({ 'ask-ai': ASK_AI_SKILL });

    const records = await store.listSkills({ tenant_id: 'default', names: ['ask-ai', 'team-skill'] });

    expect(records.map(record => record.name)).toEqual(['ask-ai', 'team-skill']);
  });

  it('exposes the git mount fields that turn execution expands', async () => {
    const { store } = skillStoreWith({ 'ask-ai': ASK_AI_SKILL });

    const [record] = await store.listSkills({ tenant_id: 'default', names: ['ask-ai'] });

    expect(record?.manifest).toEqual({ ...ASK_AI_SKILL, type: 'git', name: 'ask-ai' });
  });

  it('keeps request-scoped skills out of an unfiltered list, so they never reach tenant settings', async () => {
    const { store } = skillStoreWith({ 'ask-ai': ASK_AI_SKILL });

    const records = await store.listSkills({ tenant_id: 'default', names: undefined });

    expect(records.map(record => record.name)).toEqual(['team-skill']);
  });

  it('validate allows mixed inline and registry skills; resolve rejects sandbox-name collisions', async () => {
    const registryFqn = 'agent-skill:acme/team-a/echo:3';
    const { store, inner } = skillStoreWith(
      { echo: { ...ASK_AI_SKILL, path: 'echo' } },
      {
        resolveTurnSkills: jest.fn().mockResolvedValue([
          {
            type: 'registry',
            name: 'echo',
            description: 'Registry echo',
            fqn: registryFqn,
            preload: false,
            skillMdContent: null,
            presignedUrl: 'https://example.com/echo.tgz',
          },
        ]),
      },
    );
    const skills = [
      { name: 'echo', preload: false },
      { name: registryFqn, preload: false },
    ];

    await expect(store.validateAgentSkills({ tenant_id: 'default', skills })).resolves.toBeUndefined();
    expect(inner.validateAgentSkills).toHaveBeenCalledWith(
      { tenant_id: 'default', skills: [{ name: registryFqn, preload: false }] },
      undefined,
    );
    expect(inner.resolveTurnSkills).not.toHaveBeenCalled();

    await expect(store.resolveTurnSkills({ tenant_id: 'default', skills })).rejects.toMatchObject({
      status: 422,
      message: 'Agent skills must have unique names; duplicate skill name(s): echo',
    });
  });
});
