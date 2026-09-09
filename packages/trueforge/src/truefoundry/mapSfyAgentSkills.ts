import { z } from 'zod';
import { NameSchema } from '../schemas/common';
import type { SkillVersion } from '../schemas/skill';

/** TrueFoundry skill version manifest (SFY wire). */
const SfyRegistryManifestSchema = z.object({
  name: NameSchema,
  version: z.number().int().positive(),
  // SFY field is `ml_repo`; TrueForge wire is `skill_repo_name`.
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
    skill_repo_name: latest_version.manifest.ml_repo,
    version: latest_version.manifest.version,
  }));

const SfyRegistrySkillVersionSchema = z.object({
  fqn: z.string().min(1),
  manifest: SfyRegistryManifestSchema,
});

export type SfyRegistrySkill = z.infer<typeof SfyRegistrySkillSchema>;

/** Parse SFY registry skill list rows into the catalog wire shape. */
export function mapSfyRegistrySkills(rows: readonly unknown[]): SfyRegistrySkill[] {
  return rows.map(row => SfyRegistrySkillSchema.parse(row));
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
