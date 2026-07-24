import type { InstructionBuilder } from '../../InstructionBuilder';
import type { SandboxInit } from '../provider/Provider';
import { SKILL_DOWNLOAD_TIMEOUT_SECONDS, buildWriteAndRunScriptCommand } from '../Sandbox';
import { sandboxScripts } from '../sandboxScripts.gen';
import { SKILLS_PREAMBLE, getSkillPath, renderSkillPromptBody } from './constants';
import type { ISkillMounter } from './ISkillMounter';

// Absolute path the git skill downloader script is uploaded to before it is run.
const GIT_DOWNLOADER_PATH = '/opt/tfy/git_downloader.py';

// A git-sourced skill materialized by a SHA-pinned sparse clone. Git skills never preload — their
// SKILL.md is read from disk at runtime (only name/description/path are advertised in the prompt).
export interface GitSkill {
  readonly name: string;
  readonly description: string;
  // Canonical https clone URL of the github.com/gitlab.com repo (host-validated by the caller).
  readonly cloneUrl: string;
  // Subdirectory within the repo that holds the skill (empty = repo root).
  readonly subdir: string;
  // Immutable commit the sparse clone is pinned to; an unchanged commit is skipped on later runs.
  readonly commitSha: string;
}

// Serializable descriptor handed to git_downloader.py (base64 JSON); keys match its GitSkill model.
interface GitSkillSpec {
  name: string;
  clone_url: string;
  subdir: string;
  commit_sha: string;
}

export class SkillMounter implements ISkillMounter {
  private readonly skills: readonly GitSkill[];

  constructor(skills: readonly GitSkill[]) {
    this.skills = skills;
  }

  instruction(builder: InstructionBuilder): void {
    if (this.skills.length === 0) return;
    builder.addContent(SKILLS_PREAMBLE);
    for (const skill of this.skills) {
      builder.addSection(
        'skill',
        renderSkillPromptBody({
          path: getSkillPath(skill.name),
          name: skill.name,
          description: skill.description,
          preloadContent: null,
        }),
      );
    }
  }

  getSandboxInit(): SandboxInit {
    // An empty desired set is also the source-neutral cleanup path for a reused sandbox.
    const specs: GitSkillSpec[] = this.skills.map(skill => ({
      name: skill.name,
      clone_url: skill.cloneUrl,
      subdir: skill.subdir,
      commit_sha: skill.commitSha,
    }));
    const gitSkillsB64 = Buffer.from(JSON.stringify(specs)).toString('base64');
    return {
      command: buildWriteAndRunScriptCommand({
        scriptPath: GIT_DOWNLOADER_PATH,
        // Bundled at build time (sandboxScripts.gen.ts) so the packaged library has no loose files.
        scriptContent: sandboxScripts.gitDownloader,
      }),
      env: { AGENT_GIT_SKILLS: gitSkillsB64 },
      timeoutSeconds: SKILL_DOWNLOAD_TIMEOUT_SECONDS,
    };
  }
}
