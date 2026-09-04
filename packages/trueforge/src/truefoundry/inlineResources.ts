/**
 * MCP servers and skills supplied per request instead of configured in the tenant's registry,
 * each keyed by name.
 *
 * A caller that owns its own agent definition brings resources the tenant never registered and
 * should not see in its settings or its gateway metrics. Sending them per request keeps them out
 * of the registry entirely, and lets a rotating credential ride each turn rather than being
 * stored somewhere it will go stale.
 */
import { HTTPException } from 'hono/http-exception';
import { McpServerManifestSchema, type McpServerManifest } from '../schemas/mcpServer';
import { SkillManifestSchema, type SkillManifest } from '../schemas/skill';

export const X_TFG_MCP = 'x-tfg-mcp';
export const X_TFG_SKILLS = 'x-tfg-skills';

/** Manifests by name. `type` and `name` are implied by the header and the key, so callers omit them. */
export type InlineMcpServers = Readonly<Record<string, McpServerManifest>>;
export type InlineSkills = Readonly<Record<string, SkillManifest>>;

export function parseInlineMcpServers(raw: string): InlineMcpServers {
  return parseByName(raw, X_TFG_MCP, (name, definition) => {
    const parsed = McpServerManifestSchema.safeParse({ ...definition, type: 'remote', name });
    if (!parsed.success) {
      return { ok: false, reason: 'is not a valid MCP server definition' };
    }
    if (parsed.data.auth?.type === 'dcr') {
      return { ok: false, reason: 'cannot use dcr auth — it needs a registered client and a stored token' };
    }
    return { ok: true, manifest: parsed.data };
  });
}

export function parseInlineSkills(raw: string): InlineSkills {
  return parseByName(raw, X_TFG_SKILLS, (name, definition) => {
    const parsed = SkillManifestSchema.safeParse({ ...definition, type: 'git', name });
    return parsed.success
      ? { ok: true, manifest: parsed.data }
      : { ok: false, reason: 'is not a valid skill definition' };
  });
}

type EntryResult<TManifest> = { ok: true; manifest: TManifest } | { ok: false; reason: string };

/**
 * Rejects a malformed value rather than dropping it. Falling back to the tenant registry, where
 * these resources do not exist, would surface as a confusing "not configured" much later on.
 */
function parseByName<TManifest>(
  raw: string,
  header: string,
  parseEntry: (name: string, definition: object) => EntryResult<TManifest>,
): Readonly<Record<string, TManifest>> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    throw new HTTPException(400, { message: `${header} must be a JSON object`, cause: error });
  }
  if (!isPlainObject(decoded)) {
    throw new HTTPException(400, { message: `${header} must map each name to a definition` });
  }

  const manifests: Record<string, TManifest> = {};
  for (const [name, definition] of Object.entries(decoded)) {
    if (!isPlainObject(definition)) {
      throw new HTTPException(400, { message: `${header} entry "${name}" must be an object` });
    }
    const parsed = parseEntry(name, definition);
    if (!parsed.ok) {
      throw new HTTPException(400, { message: `${header} entry "${name}" ${parsed.reason}` });
    }
    manifests[name] = parsed.manifest;
  }
  return manifests;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
