/**
 * Catalog of models from models.yaml. Each model declares its own provider so
 * direct vendors (openai, anthropic, google, mistral, …) and gateways
 * (truefoundry, litellm, openrouter, …) can be mixed freely.
 *
 * Credentials are injected at runtime from env vars and are never exposed in
 * list output.
 */
import configuration, { CONFIG_FILES, normalizeEnvName } from '../config';
import { loadYamlFile } from './loadYaml';
import { ModelsFileSchema, type ModelEntry } from './schemas';

/**
 * Resolves `${VAR_NAME}` placeholders in a template string using `process.env`.
 * Throws clearly if a referenced variable is not set so misconfiguration is
 * caught at startup rather than silently producing empty credentials.
 */
function substituteEnvVars(template: string): string {
  return template.replace(/\$\{([^}]+)\}/g, (_, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(`Environment variable "${varName}" is not set (referenced in models.yaml api_key or headers)`);
    }
    return value;
  });
}

/** ModelEntry merged with the runtime credentials for that model. */
export type ProviderConfig = ModelEntry & {
  apiKey: string;
  headers: Record<string, string>;
};

export class ModelStore {
  private readonly models: ModelEntry[];

  constructor(models: ModelEntry[]) {
    this.models = models;
  }

  /** Loads and validates models.yaml. Throws on any error. */
  static load(): ModelStore {
    const file = loadYamlFile(CONFIG_FILES.models, ModelsFileSchema);
    return new ModelStore(file.models);
  }

  list(): ModelEntry[] {
    return this.models;
  }

  get(name: string): ModelEntry | undefined {
    return this.models.find(model => model.name === name);
  }

  /**
   * API key for the given model.
   *
   * Resolution order (first match wins):
   *   1. `api_key` field in models.yaml (supports `${VAR}` substitution)
   *   2. `MODEL_{NAME}_API_KEY` env var
   *   3. `MODEL_API_KEY` env var (global default)
   */
  getApiKey(name: string): string {
    const entry = this.get(name);
    if (entry?.api_key !== undefined) {
      return substituteEnvVars(entry.api_key);
    }
    return configuration.MODEL_API_KEY_BY_NAME[normalizeEnvName(name)] ?? configuration.MODEL_API_KEY;
  }

  /**
   * Extra headers for requests to the given model.
   *
   * Merged in ascending priority order:
   *   1. `MODEL_HEADERS` env var (global)
   *   2. `MODEL_{NAME}_HEADERS` env var (per-model)
   *   3. `headers` field in models.yaml (supports `${VAR}` substitution in values)
   */
  getHeaders(name: string): Record<string, string> {
    const entry = this.get(name);
    const inlineHeaders: Record<string, string> = {};
    if (entry?.headers !== undefined) {
      for (const [key, value] of Object.entries(entry.headers)) {
        inlineHeaders[key] = substituteEnvVars(value);
      }
    }
    return {
      ...configuration.MODEL_HEADERS,
      ...configuration.MODEL_HEADERS_BY_NAME[normalizeEnvName(name)],
      ...inlineHeaders,
    };
  }

  /**
   * Full provider config for a model: entry fields (provider, base_url, …)
   * merged with the resolved API key and headers for use by VercelAILLM.
   * Throws if the model is not registered.
   */
  getProviderConfig(name: string): ProviderConfig {
    const entry = this.get(name);
    if (!entry) {
      throw new Error(`Model not registered in models.yaml: ${name}`);
    }
    return {
      ...entry,
      apiKey: this.getApiKey(name),
      headers: this.getHeaders(name),
    };
  }
}
