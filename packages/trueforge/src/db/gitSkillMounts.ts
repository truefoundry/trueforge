import type { Skill as SkillMount } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { parseGitSkill } from '../schemas/skill';
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

/** Expand configured git skills to sandbox mounts. */
export async function resolveGitTurnSkills(
  store: Pick<ISkillStore, 'listSkills'>,
  input: AgentSkillsInput,
): Promise<SkillMount[]> {
  const { tenant_id, skills } = input;
  if (skills.length === 0) {
    return [];
  }
  const names = skills.map(skill => skill.name);
  const records = await store.listSkills({ tenant_id, names });
  const byName = new Map(records.map(record => [record.name, record]));
  const resolved: SkillMount[] = [];
  for (const skill of skills) {
    const record = byName.get(skill.name);
    if (record === undefined) {
      throw new HTTPException(422, {
        message: `Unknown skill "${skill.name}" — not configured`,
      });
    }
    const git = parseGitSkill(record.manifest);
    if (git === undefined) {
      throw new HTTPException(422, {
        message: `Skill "${skill.name}" is not a git skill`,
      });
    }
    resolved.push({
      type: 'git',
      name: git.name,
      description: git.description,
      url: git.url,
      path: git.path ?? '',
      ref: git.ref,
    });
  }
  return resolved;
}
