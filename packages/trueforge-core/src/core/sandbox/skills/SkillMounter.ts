import type { InstructionBuilder } from '../../InstructionBuilder';
import type { SandboxInit } from '../provider/Provider';
import { SKILL_DOWNLOAD_TIMEOUT_SECONDS, buildWriteAndRunScriptCommand } from '../Sandbox';
import { sandboxScripts } from '../sandboxScripts.gen';
import { SKILLS_PREAMBLE, getSkillPath, renderSkillPromptBody } from './constants';
import type { ISkillMounter } from './ISkillMounter';

// A git-sourced skill materialized by a sparse clone in the sandbox (git_downloader.py). Git skills
// never preload — their SKILL.md is read from disk at runtime (only name/description/path are
// advertised in the prompt). Wire fields match the agent_spec git mount (`url`/`path`/`name`/`ref`);
// the downloader resolves `ref` inside the sandbox before fetching.
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

// Serializable descriptor handed to git_downloader.py (base64 JSON); keys match its GitSkill model.
interface GitSkillSpec {
  name: string;
  url: string;
  path: string;
  ref: string;
}

export class SkillMounter implements ISkillMounter {
  private readonly skills: readonly GitSkill[];

  constructor(skills: readonly GitSkill[]) {
    this.skills = skills;
  }

  instruction(builder: InstructionBuilder, paths: { skillsDir: string }): void {
    if (this.skills.length === 0) {
      return;
    }
    builder.addContent(SKILLS_PREAMBLE);
    for (const skill of this.skills) {
      builder.addSection(
        'skill',
        renderSkillPromptBody({
          path: getSkillPath({ skillsDir: paths.skillsDir, skillName: skill.name }),
          name: skill.name,
          description: skill.description,
          preloadContent: null,
        }),
      );
    }
  }

  getSandboxInit(paths: { skillsDir: string; gitDownloaderPath: string }): SandboxInit {
    // An empty desired set is also the source-neutral cleanup path for a reused sandbox.
    const specs: GitSkillSpec[] = this.skills.map(skill => ({
      name: skill.name,
      url: skill.url,
      path: skill.path,
      ref: skill.ref,
    }));
    const gitSkillsB64 = Buffer.from(JSON.stringify(specs)).toString('base64');
    return {
      command: buildWriteAndRunScriptCommand({
        scriptPath: paths.gitDownloaderPath,
        // Bundled at build time (sandboxScripts.gen.ts) so the packaged library has no loose files.
        scriptContent: sandboxScripts.gitDownloader,
      }),
      env: { AGENT_GIT_SKILLS: gitSkillsB64, TFY_SKILLS_DIR: paths.skillsDir },
      timeoutSeconds: SKILL_DOWNLOAD_TIMEOUT_SECONDS,
    };
  }
}
