/**
 * Public git-based SkillMounter: prompt rendering and the declarative sandbox
 * init it hands to Sandbox. (Host-specific mounters, e.g. the gateway's
 * TrueFoundry registry mounter, are tested in their own repo.)
 */
import { InstructionBuilder } from '../../../../src/core/InstructionBuilder';
import type { ISkillMounter } from '../../../../src/core/sandbox/skills/ISkillMounter';
import { SkillMounter } from '../../../../src/core/sandbox/skills/SkillMounter';

const GIT_SKILL = {
  name: 'git-skill',
  description: 'From git',
  url: 'https://github.com/acme/skills.git',
  path: '',
  ref: 'a'.repeat(40),
};

const PROVIDER_PATHS = {
  skillsDir: '/custom/skills',
  gitDownloaderPath: '/custom/git_downloader.py',
};

// Renders a mounter's <skills> section the same way Sandbox does (empty section => '').
function renderSkills(mounter: ISkillMounter): string {
  const builder = new InstructionBuilder('skills');
  mounter.instruction(builder, { skillsDir: PROVIDER_PATHS.skillsDir });
  return builder.build();
}

describe('SkillMounter (public, git-only)', () => {
  it('embeds the injected git downloader and TFY_SKILLS_DIR', () => {
    const init = new SkillMounter([GIT_SKILL]).getSandboxInit(PROVIDER_PATHS);

    expect(init.command).toContain('/custom/git_downloader.py');
    expect(init.command).not.toContain('/opt/tfy/git_downloader.py');
    expect(init.env?.['AGENT_GIT_SKILLS']).toBeDefined();
    expect(init.env?.['TFY_SKILLS_DIR']).toBe('/custom/skills');
    expect(init.env?.['AGENT_SKILL_VERSION_FQNS']).toBeUndefined();
    expect(init.env?.['TFY_API_KEY']).toBeUndefined();
    expect(init.timeoutSeconds).toBe(180);
  });

  it('renders a <skills> section with a block per skill using the injected skills dir', () => {
    const rendered = renderSkills(new SkillMounter([GIT_SKILL]));

    expect(rendered).toContain('<skills>');
    expect(rendered).toContain('git-skill');
    expect(rendered).toContain('/custom/skills/git-skill');
    expect(rendered).not.toContain('/opt/tfy/skills');
  });

  it('uses an empty desired set for cleanup on a reused sandbox and renders nothing', () => {
    const mounter = new SkillMounter([]);
    const init = mounter.getSandboxInit(PROVIDER_PATHS);

    expect(renderSkills(mounter)).toBe('');
    expect(init.command).toContain('/custom/git_downloader.py');
    expect(init.env?.['TFY_SKILLS_DIR']).toBe('/custom/skills');
    expect(JSON.parse(Buffer.from(init.env?.['AGENT_GIT_SKILLS'] ?? '', 'base64').toString())).toEqual([]);
  });
});
