import {
  buildRenameMap,
  planHyphenOnlyName,
  planHyphenOnlyRenames,
  rewriteAgentSpecNameRefs,
} from '../../../src/db/planHyphenOnlyRenames';
import { NameSchema } from '../../../src/schemas/common';

describe('planHyphenOnlyRenames', () => {
  it('hyphenates legacy NameSchema values and appends a random suffix', () => {
    const renames = planHyphenOnlyRenames([{ tenant_id: 't', name: 'my.agent_name' }]);
    expect(renames).toHaveLength(1);
    expect(renames[0]).toMatchObject({ tenant_id: 't', from: 'my.agent_name' });
    expect(renames[0]?.to).toMatch(/^my-agent-name-[0-9a-f]{4}$/);
    expect(NameSchema.safeParse(renames[0]?.to).success).toBe(true);
  });

  it('skips hyphen-only names and non-NameSchema strings (e.g. FQNs)', () => {
    expect(planHyphenOnlyRenames([{ tenant_id: 't', name: 'my-agent' }])).toEqual([]);
    expect(planHyphenOnlyName('repo/skill:1')).toBeUndefined();
    expect(planHyphenOnlyName('openai')).toBeUndefined();
    // TrueFoundry catalog strings — must not be rewritten as local resource names.
    expect(planHyphenOnlyName('agent-skill:acme/team_a/my.echo:3')).toBeUndefined();
    expect(planHyphenOnlyName('openai/gpt-5.2')).toBeUndefined();
    expect(planHyphenOnlyName(`a${'b'.repeat(71)}`)).toBeUndefined();
  });

  it('truncates so the random suffix still fits in 64 characters', () => {
    const from = `a${'b'.repeat(61)}.b`;
    expect(from).toHaveLength(64);
    const to = planHyphenOnlyName(from);
    expect(to?.length).toBeLessThanOrEqual(64);
    expect(NameSchema.safeParse(to).success).toBe(true);
  });
});

describe('rewriteAgentSpecNameRefs', () => {
  it('rewrites model FQN, mcp, and skill refs from rename maps', () => {
    const tenantId = 't';
    const next = rewriteAgentSpecNameRefs({
      spec: {
        model: { name: 'my.prov/my.model' },
        mcp_servers: [{ name: 'my.mcp' }],
        skills: [{ name: 'my.skill' }, { name: 'repo/skill:1' }],
      },
      tenantId,
      providers: buildRenameMap([{ tenant_id: tenantId, from: 'my.prov', to: 'my-prov-aaaa' }]),
      models: new Map([[`${tenantId}\0my.prov\0my.model`, 'my-model-bbbb']]),
      mcpServers: buildRenameMap([{ tenant_id: tenantId, from: 'my.mcp', to: 'my-mcp-cccc' }]),
      skills: buildRenameMap([{ tenant_id: tenantId, from: 'my.skill', to: 'my-skill-dddd' }]),
    });

    expect(next).toEqual({
      model: { name: 'my-prov-aaaa/my-model-bbbb' },
      mcp_servers: [{ name: 'my-mcp-cccc' }],
      skills: [{ name: 'my-skill-dddd' }, { name: 'repo/skill:1' }],
    });
  });
});
