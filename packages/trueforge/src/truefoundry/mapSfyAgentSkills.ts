import { z } from 'zod';
import type { SkillVersion } from '../schemas/skill';

const SfyManifestSchema = z.object({
  name: z.string().min(1),
  version: z.number().int().positive(),
  ml_repo: z.string().min(1),
  source: z
    .object({
      description: z.string().min(1).optional(),
    })
    .optional(),
});

const SfyAgentSkillSchema = z
  .object({
    id: z.string().min(1),
    latest_version: z.object({
      fqn: z.string().min(1),
      manifest: SfyManifestSchema,
    }),
  })
  .transform(({ id, latest_version }) => ({
    id,
    name: latest_version.manifest.name,
    description: latest_version.manifest.source?.description ?? latest_version.manifest.name,
    fqn: latest_version.fqn,
    ml_repo_name: latest_version.manifest.ml_repo,
    version: latest_version.manifest.version,
  }));

const SfyAgentSkillVersionSchema = z.object({
  id: z.string().min(1),
  fqn: z.string().min(1),
  manifest: SfyManifestSchema,
});

export type SfyAvailableSkill = z.infer<typeof SfyAgentSkillSchema>;

/** Parse SFY agent-skill rows into the catalog wire shape. */
export function mapSfyAgentSkills(rows: readonly unknown[]): SfyAvailableSkill[] {
  return rows.map(row => SfyAgentSkillSchema.parse(row));
}

/** Map SFY agent-skill-version rows for the versions dropdown. */
export function mapSfyAgentSkillVersions(rows: readonly unknown[]): SkillVersion[] {
  return rows.map(row => {
    const { id, fqn, manifest } = SfyAgentSkillVersionSchema.parse(row);
    return {
      id,
      fqn,
      name: manifest.name,
      description: manifest.source?.description ?? manifest.name,
      version: manifest.version,
    };
  });
}
