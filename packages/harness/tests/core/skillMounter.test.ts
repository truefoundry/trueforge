/**
 * Public git-based SkillMounter: prompt rendering and the declarative sandbox
 * init it hands to Sandbox. (Host-specific mounters, e.g. the gateway's
 * TrueFoundry registry mounter, are tested in their own repo.)
 */
import { InstructionBuilder } from '../../src/core/InstructionBuilder';
import type { ISkillMounter } from '../../src/core/sandbox/skills/ISkillMounter';
import { SkillMounter } from '../../src/core/sandbox/skills/SkillMounter';

const GIT_SKILL = {
  name: 'git-skill',
  description: 'From git',
  cloneUrl: 'https://github.com/acme/skills.git',
  subdir: '',
  commitSha: 'a'.repeat(40),
};

// Renders a mounter's <skills> section the same way Sandbox does (empty section => '').
function renderSkills(mounter: ISkillMounter): string {
  const builder = new InstructionBuilder('skills');
  mounter.instruction(builder);
  return builder.build();
}

describe('SkillMounter (public, git-only)', () => {
  it('embeds the git downloader and passes only git skills', () => {
    const init = new SkillMounter([GIT_SKILL]).getSandboxInit();

    expect(init.command).toContain('/opt/tfy/git_downloader.py');
    expect(init.env?.['AGENT_GIT_SKILLS']).toBeDefined();
    expect(init.env?.['AGENT_SKILL_VERSION_FQNS']).toBeUndefined();
    expect(init.env?.['TFY_API_KEY']).toBeUndefined();
    expect(init.timeoutSeconds).toBe(180);
  });

  it('renders a <skills> section with a block per skill', () => {
    const rendered = renderSkills(new SkillMounter([GIT_SKILL]));

    expect(rendered).toContain('<skills>');
    expect(rendered).toContain('git-skill');
  });

  it('uses an empty desired set for cleanup on a reused sandbox and renders nothing', () => {
    const mounter = new SkillMounter([]);
    const init = mounter.getSandboxInit();

    expect(renderSkills(mounter)).toBe('');
    expect(init.command).toContain('/opt/tfy/git_downloader.py');
    expect(JSON.parse(Buffer.from(init.env?.['AGENT_GIT_SKILLS'] ?? '', 'base64').toString())).toEqual([]);
  });
});
