// Skill prompt constants and helpers: how skills are described to the agent in the system prompt.

// On-disk directory a skill is materialized into, keyed by its (unique) name.
export function getSkillPath(params: { skillsDir: string; skillName: string }): string {
  return `${params.skillsDir.replace(/\/+$/, '')}/${params.skillName}`;
}

export const SKILLS_PREAMBLE = [
  '1. The skill is present in the `path` directory.',
  '2. SKILL.md file within the directory is the primary file, there can be other files as well.',
  '3. Use `description` to judge whether the Agent needs to use a skill.',
  '4. To use a skill:',
  '4.a. If the `SKILL.md content` is inlined, the Agent must not read `path/SKILL.md`.',
  '4.b. Otherwise the Agent must read `path/SKILL.md` first.',
  '5. The Agent must avoid listing the `path` unless there are references in `SKILL.md` and there is reason to do so given the current conversation.',
].join('\n');

// The <skill> block body: inline preloaded SKILL.md when present, else advertise path/name/description.
export function renderSkillPromptBody(params: {
  path: string;
  name: string;
  description: string;
  preloadContent: string | null;
}): string {
  return params.preloadContent
    ? `path: ${params.path}\nSKILL.md content:\n${params.preloadContent}`
    : `path: ${params.path}\nname: ${params.name}\ndescription: ${params.description}`;
}
