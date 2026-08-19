/**
 * Maps trueforge-ui skill-settings calls onto Harness
 *
 * UI: `repoURL` / skill `id` / optional `catalogId`.
 * Harness: `url` / resource `name` (no separate id or catalogId on wire).
 * For now UI `id = name`; registry link uses `catalogId = name` when the
 * configured skill name matches a catalog preset.
 */
import type { TrueForge, TrueForgeApi } from '@truefoundry/trueforge-sdk';
import type { DefinedSkill, SkillCatalogEntry, SkillCatalogServer, SkillConfigBase } from '../../../server/types.js';

export type UiSkill = DefinedSkill;
export type UiSkillCatalogEntry = SkillCatalogEntry;

export function toUiCatalogEntry(skill: TrueForgeApi.CatalogSkill): UiSkillCatalogEntry {
  return {
    id: skill.name,
    name: skill.name,
    description: skill.description,
    repoURL: skill.url,
    path: skill.path ?? '',
    ref: skill.ref,
  };
}

export function toHarnessManifest(req: SkillConfigBase): TrueForgeApi.SkillManifest {
  const path = req.path.trim();
  return {
    type: 'git',
    name: req.name,
    url: req.repoURL,
    ...(path === '' ? {} : { path }),
    ref: req.ref,
    description: req.description,
  };
}

export function toUiSkill(skill: TrueForgeApi.ConfiguredSkill, catalogNames: ReadonlySet<string>): UiSkill {
  const base = {
    id: skill.name,
    name: skill.name,
    description: skill.manifest.description,
  };
  if (catalogNames.has(skill.name)) {
    return { ...base, catalogId: skill.name };
  }
  return base;
}

/** Settings skill-catalog port for `createTrueFoundryServer`. Delete omitted (no BE route). */
export function createSkillCatalog(client: TrueForge): SkillCatalogServer<UiSkill> {
  return {
    getSkillCatalog: async () => {
      const body = await client.catalogs.skills.list();
      return body.data.map(toUiCatalogEntry);
    },
    listSkills: async req => {
      const [listed, catalog] = await Promise.all([client.settings.skills.list(), client.catalogs.skills.list()]);
      const catalogNames = new Set(catalog.data.map(entry => entry.name));
      const skills = listed.data.map(skill => toUiSkill(skill, catalogNames));
      const query = req?.query?.trim().toLowerCase();
      if (query === undefined || query === '') {
        return skills;
      }
      return skills.filter(
        skill => skill.name.toLowerCase().includes(query) || skill.description.toLowerCase().includes(query),
      );
    },
    createSkill: async req => {
      const body = await client.settings.skills.create({ manifest: toHarnessManifest(req) });
      const catalogId = 'catalogId' in req ? req.catalogId : undefined;
      if (catalogId !== undefined) {
        return {
          id: body.data.name,
          name: body.data.name,
          description: body.data.manifest.description,
          catalogId,
        };
      }
      return {
        id: body.data.name,
        name: body.data.name,
        description: body.data.manifest.description,
      };
    },
  };
}
