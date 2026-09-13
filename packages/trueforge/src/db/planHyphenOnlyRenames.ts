/**
 * Decide the new hyphen-only name for an old local name.
 *
 * Only renames old-style names that still contain `.` or `_`.
 * Skips names that are already fine, and skips FQNs / other non-names.
 *
 * New name: replace `.`/`_` with `-`, add a short random suffix, keep length ≤ 64.
 */
import { randomBytes } from 'node:crypto';

/** Old name pattern (allowed `.` `_` `-`). */
export const LEGACY_NAME_SCHEMA_RE = /^[a-z](?:[a-z0-9._-]{0,62}[a-z0-9])$/;

/** New name pattern (hyphens only). */
export const HYPHEN_ONLY_NAME_RE = /^[a-z][a-z0-9-]{0,62}[a-z0-9]$/;

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export interface NamedRow {
  tenant_id: string;
  name: string;
}

export interface NameRename {
  tenant_id: string;
  from: string;
  to: string;
}

const MAX_LEN = 64;

/** New name, or undefined if this string should not be renamed. */
export function planHyphenOnlyName(name: string): string | undefined {
  // Skip if not an old-style name, or if it is already hyphen-only.
  if (!LEGACY_NAME_SCHEMA_RE.test(name) || HYPHEN_ONLY_NAME_RE.test(name)) {
    return undefined;
  }
  const suffix = `-${randomBytes(2).toString('hex')}`;
  const base = name
    .replace(/[._]/g, '-')
    .slice(0, MAX_LEN - suffix.length)
    .replace(/-+$/, '');
  return `${base}${suffix}`;
}

export function planHyphenOnlyRenames(rows: readonly NamedRow[]): NameRename[] {
  const renames: NameRename[] = [];
  for (const row of rows) {
    const to = planHyphenOnlyName(row.name);
    if (to === undefined) {
      continue;
    }
    renames.push({ tenant_id: row.tenant_id, from: row.name, to });
  }
  return renames;
}

export function renameMapKey({ tenantId, name }: { tenantId: string; name: string }): string {
  return `${tenantId}\0${name}`;
}

export function buildRenameMap(renames: readonly NameRename[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const rename of renames) {
    map.set(renameMapKey({ tenantId: rename.tenant_id, name: rename.from }), rename.to);
  }
  return map;
}

/**
 * Update names inside agent.manifest / session.agent_spec after DB columns were renamed.
 * Fixes model (`provider/model`), MCP, and skill refs. Unknown strings stay as-is.
 */
export function rewriteAgentSpecNameRefs({
  spec,
  tenantId,
  providers,
  models,
  mcpServers,
  skills,
}: {
  spec: Record<string, unknown>;
  tenantId: string;
  providers: ReadonlyMap<string, string>;
  /** Map of old model name → new model name (per tenant + provider). */
  models: ReadonlyMap<string, string>;
  mcpServers: ReadonlyMap<string, string>;
  skills: ReadonlyMap<string, string>;
}): Record<string, unknown> {
  const next: Record<string, unknown> = { ...spec };

  const model = spec['model'];
  if (isJsonObject(model)) {
    const modelObj: Record<string, unknown> = { ...model };
    const fqn = modelObj['name'];
    if (typeof fqn === 'string') {
      const slash = fqn.indexOf('/');
      if (slash > 0) {
        const providerFrom = fqn.slice(0, slash);
        const modelFrom = fqn.slice(slash + 1);
        const providerTo = providers.get(renameMapKey({ tenantId, name: providerFrom })) ?? providerFrom;
        const modelTo =
          models.get(`${tenantId}\0${providerFrom}\0${modelFrom}`) ??
          models.get(`${tenantId}\0${providerTo}\0${modelFrom}`) ??
          modelFrom;
        modelObj['name'] = `${providerTo}/${modelTo}`;
      }
    }
    next['model'] = modelObj;
  }

  const mcp = spec['mcp_servers'];
  if (Array.isArray(mcp)) {
    next['mcp_servers'] = mcp.map((entry: unknown): unknown => {
      if (!isJsonObject(entry)) {
        return entry;
      }
      const row: Record<string, unknown> = { ...entry };
      if (typeof row['name'] === 'string') {
        row['name'] = mcpServers.get(renameMapKey({ tenantId, name: row['name'] })) ?? row['name'];
      }
      return row;
    });
  }

  const skillList = spec['skills'];
  if (Array.isArray(skillList)) {
    next['skills'] = skillList.map((entry: unknown): unknown => {
      if (!isJsonObject(entry)) {
        return entry;
      }
      const row: Record<string, unknown> = { ...entry };
      if (typeof row['name'] === 'string') {
        row['name'] = skills.get(renameMapKey({ tenantId, name: row['name'] })) ?? row['name'];
      }
      return row;
    });
  }

  return next;
}
