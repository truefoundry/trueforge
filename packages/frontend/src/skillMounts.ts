/**
 * Maps skills.yaml catalog rows to git mounts persisted on agent_spec.skills.
 * Always sends `ref` (catalog `ref`, or HEAD when omitted). The sandbox
 * git_downloader resolves branch/tag refs via git ls-remote before sparse-clone.
 */
import type { AgentSpec } from '@truefoundry/assistant-ui-runtime';
import type { SkillEntry } from './catalog';

/** Default git ref when skills.yaml omits `ref` (tracks the remote default branch). */
export const DEFAULT_SKILL_REF = 'HEAD';

export type GitSkillMount = Extract<NonNullable<AgentSpec['skills']>[number], { type: 'git' }>;

function isGitSkillMount(skill: NonNullable<AgentSpec['skills']>[number]): skill is GitSkillMount {
  return skill.type === 'git';
}

export function toGitSkillMount(entry: SkillEntry): GitSkillMount {
  const mount: GitSkillMount = {
    type: 'git',
    url: entry.url,
    name: entry.name,
    description: entry.description,
    ref: entry.ref ?? DEFAULT_SKILL_REF,
  };
  if (entry.path !== undefined) {
    mount.path = entry.path;
  }
  return mount;
}

export function skillMountsFromNames(names: ReadonlySet<string>, catalog: readonly SkillEntry[]): GitSkillMount[] {
  const byName = new Map(catalog.map(entry => [entry.name, entry]));
  const mounts: GitSkillMount[] = [];
  for (const name of names) {
    const entry = byName.get(name);
    if (entry) mounts.push(toGitSkillMount(entry));
  }
  return mounts;
}

export function selectedSkillNamesFromSpec(skills: AgentSpec['skills']): ReadonlySet<string> {
  return new Set((skills ?? []).filter(isGitSkillMount).map(skill => skill.name));
}
