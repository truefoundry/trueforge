import { planAgentNameHyphenRenames } from '../../../src/db/planAgentNameHyphenRenames';
import { AgentNameSchema } from '../../../src/schemas/common';

describe('planAgentNameHyphenRenames', () => {
  it('hyphenates and appends a random suffix', () => {
    const renames = planAgentNameHyphenRenames([{ id: '1', tenant_id: 't', name: 'my.agent_name' }]);
    expect(renames).toHaveLength(1);
    expect(renames[0]).toMatchObject({ id: '1', tenant_id: 't', from: 'my.agent_name' });
    expect(renames[0]?.to).toMatch(/^my-agent-name-[0-9a-f]{4}$/);
    expect(AgentNameSchema.safeParse(renames[0]?.to).success).toBe(true);
  });

  it('skips names that are already hyphen-only', () => {
    expect(planAgentNameHyphenRenames([{ id: '1', tenant_id: 't', name: 'my-agent' }])).toEqual([]);
  });

  it('truncates so the random suffix still fits in 64 characters', () => {
    const from = `a${'b'.repeat(61)}.b`;
    expect(from).toHaveLength(64);
    const to = planAgentNameHyphenRenames([{ id: '1', tenant_id: 't', name: from }])[0]?.to;
    expect(to?.length).toBeLessThanOrEqual(64);
    expect(AgentNameSchema.safeParse(to).success).toBe(true);
  });
});
