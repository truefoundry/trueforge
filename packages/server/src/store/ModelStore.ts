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

  /** API key for the given model: MODEL_{NAME}_API_KEY override, else MODEL_API_KEY. */
  getApiKey(name: string): string {
    return configuration.MODEL_API_KEY_BY_NAME[normalizeEnvName(name)] ?? configuration.MODEL_API_KEY;
  }

  /**
   * Extra headers for requests to the given model: MODEL_HEADERS plus
   * per-model MODEL_{NAME}_HEADERS overrides. Auth is not included — the API
   * key is passed separately via getApiKey().
   */
  getHeaders(name: string): Record<string, string> {
    return {
      ...configuration.MODEL_HEADERS,
      ...configuration.MODEL_HEADERS_BY_NAME[normalizeEnvName(name)],
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
