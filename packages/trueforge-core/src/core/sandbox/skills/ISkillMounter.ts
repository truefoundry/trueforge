import type { InstructionBuilder } from '../../InstructionBuilder';
import type { SandboxInit } from '../provider/Provider';

// A set of skills that describes itself in the prompt and installs itself into a sandbox. The sandbox
// holds one mounter and never inspects individual skills.
export interface ISkillMounter {
  // Renders the <skills> section; adds nothing when empty, so InstructionBuilder drops the section.
  instruction(builder: InstructionBuilder, paths: { skillsDir: string }): void;
  // The command (+ env, timeout) that installs these skills; Sandbox folds it into its init exec.
  getSandboxInit(paths: { skillsDir: string; gitDownloaderPath: string }): SandboxInit;
}
