/**
 * Dynamic model discovery for well-known providers that publish an OpenAI-compatible
 * `GET /models` catalog (OpenCode Go). The shipped catalog presets are a minimal seed;
 * on every provider save we refresh the roster so the UI never shows a stale list.
 */
import type { Logger } from 'winston';
import { NameSchema } from '../schemas/common';
import type { ConfiguredModel, ModelProviderManifest } from '../schemas/modelProvider';

/** Bound one upstream discovery call; a settings save must not hang on a slow provider. */
export const MODEL_DISCOVERY_TIMEOUT_MS = 5_000;

/** Derive a NameSchema-valid slug from an upstream model id, e.g. "gpt-5.6-luna" -> "gpt-5-6-luna". */
function slugifyModelId(raw: string): string {
  return raw
    .replace(/([a-zA-Z])(\d)/g, '$1-$2') // ids like "kimi-k2.7" need a separator before the digit
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+/, '')
    .slice(0, 64)
    .replace(/-+$/g, '');
}

/**
 * Fetch the provider's live model ids from `GET {base_url}/models` (OpenAI-compatible list).
 * Never throws: any failure returns an empty list so callers fall back to the stored manifest.
 */
export async function fetchOpenCodeGoModelIds({
  baseUrl,
  apiKey,
  logger,
}: {
  baseUrl: string;
  apiKey: string | undefined;
  logger?: Logger | undefined;
}): Promise<string[]> {
  const url = `${baseUrl.replace(/\/+$/, '')}/models`;
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        ...(apiKey === undefined ? {} : { authorization: `Bearer ${apiKey}` }),
      },
      signal: AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS),
    });
    if (!response.ok) {
      logger?.warn(`OpenCode Go model discovery failed: GET ${url} returned ${response.status}`);
      return [];
    }
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    const ids = (body.data ?? [])
      .map(entry => entry?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    logger?.info(`OpenCode Go model discovery: discovered ${ids.length} models`);
    return ids;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger?.warn(`OpenCode Go model discovery failed: GET ${url}: ${message}`);
    return [];
  }
}

/**
 * Union the discovered ids with the manifest's current models so a save never drops a model
 * that is already configured. Existing entries win on a `model_id` collision (their names and
 * properties stay); new ids are appended with a slug name and no capability metadata.
 */
export function expandOpenCodeGoModels(
  manifest: ModelProviderManifest,
  discoveredIds: readonly string[],
): ModelProviderManifest {
  const known = new Set(manifest.models.map(model => model.model_id));
  const added: ConfiguredModel[] = [];
  for (const id of discoveredIds) {
    if (known.has(id)) {
      continue;
    }
    const name = NameSchema.safeParse(slugifyModelId(id));
    if (!name.success) {
      continue;
    }
    known.add(id);
    added.push({ model_id: id, name: name.data, properties: {} });
  }
  return added.length === 0 ? manifest : { ...manifest, models: [...manifest.models, ...added] };
}
