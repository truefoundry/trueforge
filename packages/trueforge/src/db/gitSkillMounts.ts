import { HTTPException } from 'hono/http-exception';
import type { AgentSkillsInput, ISkillStore } from './skillStore';

/** Admit configured git skills; reject preload. */
export async function validateGitAgentSkills(
  store: Pick<ISkillStore, 'listSkills'>,
  input: AgentSkillsInput,
): Promise<void> {
  const { tenant_id, skills } = input;
  if (skills.length === 0) {
    return;
  }
  for (const skill of skills) {
    if (skill.preload) {
      throw new HTTPException(422, {
        message: `Skill "${skill.name}": preload is not supported for git skills`,
      });
    }
  }
  const names = skills.map(skill => skill.name);
  const byName = new Map((await store.listSkills({ tenant_id, names })).map(record => [record.name, record]));
  for (const skill of skills) {
    const record = byName.get(skill.name);
    if (record === undefined) {
      throw new HTTPException(422, {
        message: `Unknown skill "${skill.name}" — not configured`,
      });
    }
    if (record.manifest.type !== 'git') {
      throw new HTTPException(422, {
        message: `Skill "${skill.name}" is not a git skill`,
      });
    }
  }
}
