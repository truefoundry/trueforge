/**
 * Shipped skill catalog (skill-catalog.yaml): the discovery list of skill
 * presets offered by GET /catalogs/skills for the UI to copy into
 * PUT /settings/skills bodies. Never consulted on writes and never
 * read by the runtime.
 *
 * Default: YAML inlined into `skillCatalog.gen.ts` at build time. Optional
 * override: `SKILL_CATALOG_PATH` (file on disk).
 */
import configuration from '../config';
import { SkillCatalogFileSchema, type CatalogSkill } from '../schemas/skillCatalog';
import { loadYamlAtPath, parseYamlString } from './loadYaml';
import { shippedSkillCatalogYaml } from './skillCatalog.gen';

export class SkillCatalog {
  private readonly skills: readonly CatalogSkill[];

  constructor(skills: readonly CatalogSkill[]) {
    this.skills = skills;
  }

  /** Loads and validates the catalog. Throws on any error. */
  static load(): SkillCatalog {
    if (configuration.SKILL_CATALOG_PATH !== undefined) {
      const file = loadYamlAtPath(configuration.SKILL_CATALOG_PATH, SkillCatalogFileSchema);
      return new SkillCatalog(file.skills);
    }
    const file = parseYamlString(shippedSkillCatalogYaml, SkillCatalogFileSchema, 'shipped skill-catalog');
    return new SkillCatalog(file.skills);
  }

  list(): readonly CatalogSkill[] {
    return this.skills;
  }
}
