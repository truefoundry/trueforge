/**
 * SkillMounter: prompt rendering and the declarative sandbox init it hands to Sandbox.
 */
import { InstructionBuilder } from '../../../../src/core/InstructionBuilder';
import type { ISkillMounter } from '../../../../src/core/sandbox/skills/ISkillMounter';
import {
  REQUESTED_SKILLS_FILE_NAME,
  SkillMounter,
  type GitSkill,
  type Skill,
} from '../../../../src/core/sandbox/skills/SkillMounter';

const GIT_SKILL = {
  type: 'git',
  name: 'git-skill',
  description: 'From git',
  url: 'https://github.com/acme/skills.git',
  path: '',
  ref: 'a'.repeat(40),
} satisfies GitSkill;

const REGISTRY_SKILL = {
  type: 'registry',
  name: 'echo',
  description: 'Echo',
  fqn: 'agent-skill:acme/team/echo:1',
  preload: false,
  skillMdContent: null,
  presignedUrl: 'https://example.com/echo.tar',
} satisfies Skill;

const PATHS = {
  skillsDir: '/custom/skills',
  gitDownloaderPath: '/custom/git_downloader.py',
};

function renderSkills(mounter: ISkillMounter): string {
  const builder = new InstructionBuilder('skills');
  mounter.instruction(builder, { skillsDir: PATHS.skillsDir });
  return builder.build();
}

function readRequestedFile(mounter: SkillMounter): unknown {
  const { uploads } = mounter.getSandboxInit(PATHS);
  expect(uploads).toHaveLength(1);
  const content = uploads[0]?.content.toString('utf-8');
  expect(typeof content).toBe('string');
  return JSON.parse(content ?? '');
}

describe('SkillMounter', () => {
  it('uploads git skills in the requested file and points the init command at the downloader', () => {
    const mounter = new SkillMounter({ skills: [GIT_SKILL] });
    const init = mounter.getSandboxInit(PATHS);

    expect(init.command).toContain(PATHS.gitDownloaderPath);
    expect(init.env?.['TFY_SKILLS_DIR']).toBe(PATHS.skillsDir);
    expect(init.timeoutSeconds).toBe(180);
    expect(init.uploads[0]?.remotePath).toBe(`${PATHS.skillsDir}/${REQUESTED_SKILLS_FILE_NAME}`);
    expect(readRequestedFile(mounter)).toEqual({
      skills: [{ type: 'git', name: 'git-skill', url: GIT_SKILL.url, path: '', ref: GIT_SKILL.ref }],
    });
  });

  it('renders skill prompt blocks under the injected skills dir', () => {
    const rendered = renderSkills(new SkillMounter({ skills: [GIT_SKILL] }));
    expect(rendered).toContain('<skills>');
    expect(rendered).toContain(`${PATHS.skillsDir}/git-skill`);
  });

  it('uploads an empty requested file so that existing skills are cleaned up', () => {
    const mounter = new SkillMounter({});
    expect(renderSkills(mounter)).toBe('');
    expect(readRequestedFile(mounter)).toEqual({ skills: [] });
  });

  it('writes git and registry entries into one requested file in caller order', () => {
    expect(readRequestedFile(new SkillMounter({ skills: [GIT_SKILL, REGISTRY_SKILL] }))).toEqual({
      skills: [
        { type: 'git', name: 'git-skill', url: GIT_SKILL.url, path: '', ref: GIT_SKILL.ref },
        {
          type: 'registry',
          name: 'echo',
          fqn: 'agent-skill:acme/team/echo:1',
          presigned_url: 'https://example.com/echo.tar',
        },
      ],
    });
  });
});
