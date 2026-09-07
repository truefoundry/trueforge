import type { InstructionBuilder } from '../../InstructionBuilder';
import type { SandboxInit } from '../provider/Provider';
import { SKILL_DOWNLOAD_TIMEOUT_SECONDS, buildWriteAndRunScriptCommand } from '../Sandbox';
import { sandboxScripts } from '../sandboxScripts.gen';
import { SKILLS_PREAMBLE, getSkillPath, renderSkillPromptBody } from './constants';
import type { ISkillMounter } from './ISkillMounter';

/** Git skill: sparse-cloned in the sandbox by git_downloader.py (never preloaded). */
export interface GitSkill {
  readonly name: string;
  readonly description: string;
  // Canonical https clone URL of the github.com/gitlab.com repo (host-validated by the caller).
  readonly url: string;
  // Subdirectory within the repo that holds the skill (empty = repo root).
  readonly path: string;
  // Branch, tag, or full object id — resolved and fetched by git_downloader.py in the sandbox.
  readonly ref: string;
}

/** Registry skill: sandbox dir uses artifact `name`; AgentSpec stores `fqn`. */
export interface RegistrySkill {
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

export const DESIRED_SKILLS_FILE_NAME = '.tfy-desired-skills.json';

/** Wire entry in `.tfy-desired-skills.json` (git arm). */
interface DesiredGitSkill {
  type: 'git';
  name: string;
  url: string;
  path: string;
  ref: string;
}

/** Wire entry in `.tfy-desired-skills.json` (registry arm). */
interface DesiredRegistrySkill {
  type: 'registry';
  name: string;
  fqn: string;
  presigned_url: string;
}

type DesiredSkill = DesiredGitSkill | DesiredRegistrySkill;

export class SkillMounter implements ISkillMounter {
  private readonly gitSkills: readonly GitSkill[];
  private readonly registrySkills: readonly RegistrySkill[];

  constructor(input: { gitSkills?: readonly GitSkill[]; registrySkills?: readonly RegistrySkill[] } = {}) {
    this.gitSkills = input.gitSkills ?? [];
    this.registrySkills = input.registrySkills ?? [];
  }

  instruction(builder: InstructionBuilder, paths: { skillsDir: string }): void {
    if (this.gitSkills.length === 0 && this.registrySkills.length === 0) {
      return;
    }
    builder.addContent(SKILLS_PREAMBLE);
    for (const skill of this.registrySkills) {
      this.#addPromptSkill(builder, paths.skillsDir, {
        name: skill.name,
        description: skill.description,
        preloadContent: skill.preload ? skill.skillMdContent : null,
      });
    }
    for (const skill of this.gitSkills) {
      this.#addPromptSkill(builder, paths.skillsDir, {
        name: skill.name,
        description: skill.description,
        preloadContent: null,
      });
    }
  }

  getSandboxInit(paths: { skillsDir: string; gitDownloaderPath: string }): SandboxInit {
    // Always upload (including empty) so a reused sandbox can prune.
    const skills: DesiredSkill[] = [
      ...this.gitSkills.map((skill): DesiredGitSkill => ({
        type: 'git',
        name: skill.name,
        url: skill.url,
        path: skill.path,
        ref: skill.ref,
      })),
      ...this.registrySkills.map((skill): DesiredRegistrySkill => ({
        type: 'registry',
        name: skill.name,
        fqn: skill.fqn,
        presigned_url: skill.presignedUrl,
      })),
    ];

    return {
      command: buildWriteAndRunScriptCommand({
        scriptPath: paths.gitDownloaderPath,
        scriptContent: sandboxScripts.gitDownloader,
      }),
      env: { TFY_SKILLS_DIR: paths.skillsDir },
      timeoutSeconds: SKILL_DOWNLOAD_TIMEOUT_SECONDS,
      uploads: [
        {
          remotePath: `${paths.skillsDir}/${DESIRED_SKILLS_FILE_NAME}`,
          content: Buffer.from(JSON.stringify({ skills }), 'utf-8'),
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
