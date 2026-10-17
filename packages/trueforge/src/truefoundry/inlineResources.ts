/**
 * MCP servers, skills, and model providers supplied per request instead of configured in the
 * tenant's registry, each keyed by name.
 *
 * A caller that owns its own agent definition brings resources the tenant never registered and
 * should not see in its settings or its gateway metrics. Sending them per request keeps them out
 * of the registry entirely, and lets a rotating credential ride each turn rather than being
 * stored somewhere it will go stale.
 */
import { HTTPException } from 'hono/http-exception';
import { McpServerManifestSchema, type McpServerManifest } from '../schemas/mcpServer';
import { ModelProviderManifestSchema, type ModelProviderManifest } from '../schemas/modelProvider';
import { GitSkillSchema, type GitSkill } from '../schemas/skill';

export const X_TFG_MCP = 'x-tfg-mcp';
export const X_TFG_SKILLS = 'x-tfg-skills';
export const X_TFG_MODELS = 'x-tfg-models';

/**
 * Fail closed: those headers are rejected unless TrueFoundry mode is on and the caller
 * opted in (`allowInlineResources: true` on inline session create or spec replace, or on a
 * turn for an inline session). Create and replace use them only to validate the spec; they
 * are not stored.
 * Does not cover `x-tfg-mcp-headers` — that only adds per-server invoke headers, it does not
 * define MCP servers.
 */
export function assertInlineResourceHeadersAllowed(input: {
  headerNames: string[];
  isTrueFoundryMode: boolean;
  allowInlineResources: boolean;
}): void {
  const labeled = input.headerNames.join('/');
  if (!input.isTrueFoundryMode) {
    throw new HTTPException(400, { message: `${labeled} requires TrueFoundry mode` });
  }
  if (!input.allowInlineResources) {
    throw new HTTPException(400, {
      message: `${labeled} is only allowed when creating or updating an inline session, or on a turn for one`,
    });
  }
}

/** Manifests by name. `type` and `name` are implied by the header and the key, so callers omit them. */
export type InlineMcpServers = Readonly<Record<string, McpServerManifest>>;
export type InlineSkills = Readonly<Record<string, GitSkill>>;
/** Keyed by provider name: a spec addresses a model as `provider/model`, so the provider is the unit. */
export type InlineModelProviders = Readonly<Record<string, ModelProviderManifest>>;

export function parseInlineMcpServers(raw: string): InlineMcpServers {
  return parseByName({
    raw,
    header: X_TFG_MCP,
    parseEntry: (name, definition) => {
      const parsed = McpServerManifestSchema.safeParse({ ...definition, type: 'remote', name });
      if (!parsed.success) {
        return { ok: false, reason: 'is not a valid MCP server definition' };
      }
      if (parsed.data.auth?.type === 'dcr') {
        return { ok: false, reason: 'cannot use dcr auth — it needs a registered client and a stored token' };
      }
      return { ok: true, manifest: parsed.data };
    },
  });
}

export function parseInlineSkills(raw: string): InlineSkills {
  return parseByName({
    raw,
    header: X_TFG_SKILLS,
    parseEntry: (name, definition) => {
      const parsed = GitSkillSchema.safeParse({ ...definition, type: 'git', name });
      return parsed.success
        ? { ok: true, manifest: parsed.data }
        : { ok: false, reason: 'is not a valid skill definition' };
    },
  });
}

/**
 * `custom` is the only provider type that carries its own name and endpoint, and it speaks the
 * OpenAI-compatible API every gateway exposes, so it is the one an inline definition maps onto.
 */
export function parseInlineModelProviders(raw: string): InlineModelProviders {
  return parseByName({
    raw,
    header: X_TFG_MODELS,
    parseEntry: (name, definition) => {
      const parsed = ModelProviderManifestSchema.safeParse({ ...definition, type: 'custom', name });
      return parsed.success
        ? { ok: true, manifest: parsed.data }
        : { ok: false, reason: 'is not a valid model provider definition' };
    },
  });
}

type EntryResult<TManifest> = { ok: true; manifest: TManifest } | { ok: false; reason: string };

/**
 * Rejects a malformed value rather than dropping it. Falling back to the tenant registry, where
 * these resources do not exist, would surface as a confusing "not configured" much later on.
 */
function parseByName<TManifest>(input: {
  raw: string;
  header: string;
  parseEntry: (name: string, definition: object) => EntryResult<TManifest>;
}): Readonly<Record<string, TManifest>> {
  const { raw, header, parseEntry } = input;
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    throw new HTTPException(400, { message: `${header} must be a JSON object`, cause: error });
  }
  if (!isPlainObject(decoded)) {
    throw new HTTPException(400, { message: `${header} must map each name to a definition` });
  }

  // `{}` inherits Object.prototype, so `map['constructor']` is Object (not undefined).
  // NameSchema allows `constructor`, so strip the prototype (avoids Object.create(null)'s `any`).
  const manifests: Record<string, TManifest> = {};
  Object.setPrototypeOf(manifests, null);
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
