import { HTTPException } from 'hono/http-exception';
import type { IMcpServerWithAuthStore, McpServerRecord } from '../../../src/db/mcpServerStore';
import type { ISkillStore, SkillRecord } from '../../../src/db/skillStore';
import { InlineMcpServerStore } from '../../../src/truefoundry/InlineMcpServerStore';
import { parseInlineMcpServers, parseInlineSkills } from '../../../src/truefoundry/inlineResources';
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

function mcpStoreWith(inlineRaw: object) {
  const inner = {
    getServer: jest.fn().mockResolvedValue(registryServer),
    listServers: jest.fn().mockResolvedValue({ data: [registryServer], pagination: { limit: 10 } }),
    resolveInvokeHeaders: jest.fn().mockReturnValue({ Authorization: 'Bearer caller-token' }),
    resolveAuthStatuses: jest.fn().mockResolvedValue(new Map([['team-mcp', { status: 'not_required' }]])),
  } as unknown as IMcpServerWithAuthStore;
  const store = new InlineMcpServerStore({
    inner,
    inline: parseInlineMcpServers(JSON.stringify(inlineRaw)),
  });
  return { store, inner };
}

function skillStoreWith(inlineRaw: object) {
  const inner = {
    getSkill: jest.fn().mockResolvedValue(registrySkill),
    listSkills: jest.fn().mockResolvedValue([registrySkill]),
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

describe('InlineMcpServerStore', () => {
  it('sends the credentials the manifest carries, with no caller Bearer added over them', () => {
    const { store } = mcpStoreWith({ 'docs-mcp': DOCS_MCP });
    const record = { ...registryServer, name: 'docs-mcp' };

    expect(store.resolveInvokeHeaders({ record, userRef: 'user-1' })).toEqual({
      Authorization: 'Bearer saas-token',
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

  it('answers a name-filtered list from both sources, which is what spec validation asks for', async () => {
    const { store } = mcpStoreWith({ 'docs-mcp': DOCS_MCP });

    const { data } = await store.listServers({
      tenant_id: 'default',
      names: ['docs-mcp', 'team-mcp'],
      limit: 10,
      page_token: undefined,
    });

    expect(data.map(record => record.name)).toEqual(['docs-mcp', 'team-mcp']);
  });

  it('keeps request-scoped servers out of an unfiltered list, so they never reach tenant settings', async () => {
    const { store } = mcpStoreWith({ 'docs-mcp': DOCS_MCP });

    const { data } = await store.listServers({
      tenant_id: 'default',
      names: undefined,
      limit: 10,
      page_token: undefined,
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

    const record = await store.getSkill({ tenant_id: 'default', name: 'ask-ai' });

    expect(record?.manifest).toEqual({ ...ASK_AI_SKILL, type: 'git', name: 'ask-ai' });
  });

  it('keeps request-scoped skills out of an unfiltered list, so they never reach tenant settings', async () => {
    const { store } = skillStoreWith({ 'ask-ai': ASK_AI_SKILL });

    const records = await store.listSkills({ tenant_id: 'default', names: undefined });

    expect(records.map(record => record.name)).toEqual(['team-skill']);
  });
});
