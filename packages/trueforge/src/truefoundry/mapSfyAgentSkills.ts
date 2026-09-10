import { z } from 'zod';
import type { SkillVersion } from '../schemas/skill';

/** TrueFoundry skill version manifest (SFY wire). */
const SfyRegistryManifestSchema = z.object({
  // Display label only — not TF ResourceName / DNS-label rules.
  name: z.string().min(1),
  version: z.number().int().positive(),
  // SFY field is `ml_repo`; TrueForge wire is `repository_name`.
  ml_repo: z.string().min(1),
  source: z
    .object({
      description: z.string().min(1).optional(),
    })
    .optional(),
});

const SfyRegistrySkillSchema = z
  .object({
    latest_version: z.object({
      fqn: z.string().min(1),
      manifest: SfyRegistryManifestSchema,
    }),
  })
  .transform(({ latest_version }) => ({
    // Wire identity is the version FQN; short SFY name is display-only.
    name: latest_version.fqn,
    display_name: latest_version.manifest.name,
    description: latest_version.manifest.source?.description ?? latest_version.manifest.name,
    repository_name: latest_version.manifest.ml_repo,
    version: latest_version.manifest.version,
  }));

const SfyRegistrySkillVersionSchema = z.object({
  agent_skill_id: z.string().min(1),
  fqn: z.string().min(1),
  manifest: SfyRegistryManifestSchema,
});

export type SfyRegistrySkill = z.infer<typeof SfyRegistrySkillSchema>;

/** One resolved skill version from `…/agent-skill-versions/resolve`. */
export const ResolvedAgentSkillVersionSchema = z.object({
  fqn: z.string().min(1),
  name: z.string().min(1),
  description: z.string().min(1),
});

export type ResolvedAgentSkillVersion = z.infer<typeof ResolvedAgentSkillVersionSchema>;

const ResolveAgentSkillVersionsResponseSchema = z.object({
  skills: z.array(ResolvedAgentSkillVersionSchema),
});

/** Parse SFY registry skill list rows into the catalog wire shape. */
export function mapSfyRegistrySkills(rows: readonly unknown[]): SfyRegistrySkill[] {
  return rows.map(row => SfyRegistrySkillSchema.parse(row));
}

/** Parse one SFY agent-skill-version. */
export function parseSfyRegistrySkillVersion(version: unknown): z.infer<typeof SfyRegistrySkillVersionSchema> {
  return SfyRegistrySkillVersionSchema.parse(version);
}

/** Map SFY registry skill-version rows for the versions dropdown. */
export function mapSfyRegistrySkillVersions(rows: readonly unknown[]): SkillVersion[] {
  return rows.map(row => {
    const { fqn, manifest } = SfyRegistrySkillVersionSchema.parse(row);
    return {
      name: fqn,
      display_name: manifest.name,
      description: manifest.source?.description ?? manifest.name,
      version: manifest.version,
    };
  });
}

/** Parse resolve response body. */
export function mapResolvedAgentSkillVersions(payload: unknown): ResolvedAgentSkillVersion[] {
  return ResolveAgentSkillVersionsResponseSchema.parse(payload).skills;
}
