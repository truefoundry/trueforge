import type { InstructionBuilder } from '../../InstructionBuilder';
import type { SandboxInit } from '../provider/Provider';
import { SKILL_DOWNLOAD_TIMEOUT_SECONDS, buildWriteAndRunScriptCommand } from '../Sandbox';
import { sandboxScripts } from '../sandboxScripts.gen';
import { SKILLS_PREAMBLE, getSkillPath, renderSkillPromptBody } from './constants';
import type { ISkillMounter } from './ISkillMounter';

/** Git skill: sparse-cloned in the sandbox by skill_downloader.py (never preloaded). */
export interface GitSkill {
  readonly type: 'git';
  readonly name: string;
  readonly description: string;
  // Canonical https clone URL of the github.com/gitlab.com repo (host-validated by the caller).
  readonly url: string;
  // Subdirectory within the repo that holds the skill (empty = repo root).
  readonly path: string;
  // Branch, tag, or full object id — resolved and fetched by skill_downloader.py in the sandbox.
  readonly ref: string;
}

/** Registry skill: sandbox dir uses artifact `name`; AgentSpec stores `fqn`. */
interface RegistrySkill {
  readonly type: 'registry';
  readonly name: string;
  readonly description: string;
  // Version FQN from AgentSpec (`agent-skill:tenant/ml_repo/name:N`).
  readonly fqn: string;
  // When true, inline `skillMdContent` into the prompt instead of reading SKILL.md from disk.
  readonly preload: boolean;
  // SKILL.md body when `preload` is true; otherwise null.
  readonly skillMdContent: string | null;
  // Short-lived URL the sandbox uses to download the skill tarball.
  readonly presignedUrl: string;
}

export type Skill = GitSkill | RegistrySkill;

export const REQUESTED_SKILLS_FILE_NAME = '.tfy-requested-skills.json';

type RequestedGitSkill = Pick<GitSkill, 'type' | 'name' | 'url' | 'path' | 'ref'>;

type RequestedRegistrySkill = Pick<RegistrySkill, 'type' | 'name' | 'fqn'> & {
  // Host↔sandbox wire: JSON/Python use snake_case; RegistrySkill stays camelCase.
  presigned_url: RegistrySkill['presignedUrl'];
};

type RequestedSkill = RequestedGitSkill | RequestedRegistrySkill;

function toRequestedSkill(skill: Skill): RequestedSkill {
  switch (skill.type) {
    case 'registry': {
      const { name, fqn, presignedUrl: presigned_url } = skill;
      // Rename at upload: downloader reads `presigned_url`, never `presignedUrl`.
      return { type: 'registry', name, fqn, presigned_url };
    }
    case 'git': {
      const { name, url, path, ref } = skill;
      return { type: 'git', name, url, path, ref };
    }
    default: {
      const _exhaustive: never = skill;
      throw new Error(`unexpected skill: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

/** Inline SKILL.md for the prompt when the registry skill is preloaded; git never preloads. */
function resolvePreloadContent(skill: Skill): string | null {
  switch (skill.type) {
    case 'registry':
      return skill.preload ? skill.skillMdContent : null;
    case 'git':
      return null;
    default: {
      const _exhaustive: never = skill;
      throw new Error(`unexpected skill: ${JSON.stringify(_exhaustive)}`);
    }
  }
}

export class SkillMounter implements ISkillMounter {
  private readonly skills: readonly Skill[];

  constructor(input: { skills?: readonly Skill[] } = {}) {
    this.skills = input.skills ?? [];
  }

  instruction(builder: InstructionBuilder, paths: { skillsDir: string }): void {
    if (this.skills.length === 0) {
      return;
    }
    builder.addContent(SKILLS_PREAMBLE);
    for (const skill of this.skills) {
      this.#addPromptSkill(builder, paths.skillsDir, {
        name: skill.name,
        description: skill.description,
        preloadContent: resolvePreloadContent(skill),
      });
    }
  }

  getSandboxInit(paths: { skillsDir: string; skillDownloaderPath: string }): SandboxInit {
    // Always upload (including empty) so that existing skills are cleaned up.
    return {
      command: buildWriteAndRunScriptCommand({
        scriptPath: paths.skillDownloaderPath,
        scriptContent: sandboxScripts.skillDownloader,
      }),
      env: { TFY_SKILLS_DIR: paths.skillsDir },
      timeoutSeconds: SKILL_DOWNLOAD_TIMEOUT_SECONDS,
      uploads: [
        {
          remotePath: `${paths.skillsDir}/${REQUESTED_SKILLS_FILE_NAME}`,
          content: Buffer.from(JSON.stringify({ skills: this.skills.map(toRequestedSkill) }), 'utf-8'),
        },
      ],
    };
  }

  #addPromptSkill(
    builder: InstructionBuilder,
    skillsDir: string,
    skill: { name: string; description: string; preloadContent: string | null },
  ): void {
    builder.addSection(
      'skill',
      renderSkillPromptBody({
        path: getSkillPath({ skillsDir, skillName: skill.name }),
        name: skill.name,
        description: skill.description,
        preloadContent: skill.preloadContent,
      }),
    );
  }
}
