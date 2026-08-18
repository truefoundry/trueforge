import { AgentSpecSchema } from '../../src/agent-session/schemas/agentSpec';

describe('AgentSpecSchema skills', () => {
  it('accepts name-only Skill entries', () => {
    const parsed = AgentSpecSchema.parse({
      model: { name: 'test-provider/test-model' },
      skills: [{ name: 'my-skill' }],
    });
    expect(parsed.skills).toEqual([{ name: 'my-skill' }]);
  });

  it('rejects skill mounts with extra fields', () => {
    const result = AgentSpecSchema.safeParse({
      model: { name: 'test-provider/test-model' },
      skills: [{ name: 'my-skill', type: 'git', url: 'https://github.com/acme/skills' }],
    });
    expect(result.success).toBe(false);
  });
});
