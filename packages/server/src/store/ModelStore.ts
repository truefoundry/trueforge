/**
 * Catalog of models from models.yaml. Every model is reached through the
 * OpenAI-compatible API at the file's base_url, authenticated with
 * MODEL_API_KEY (or a per-model MODEL_{NAME}_API_KEY override);
 * MODEL_HEADERS / MODEL_{NAME}_HEADERS add extra headers. Credentials are
 * never exposed in list output.
 */
import { loadYamlFile } from '../catalog/loadYaml';
import configuration, { CONFIG_FILES, normalizeEnvName } from '../config';
import { ModelsFileSchema, type ModelEntry } from './schemas';

export class ModelStore {
  readonly baseUrl: string;
  private readonly models: ModelEntry[];

  constructor(baseUrl: string, models: ModelEntry[]) {
    this.baseUrl = baseUrl;
    this.models = models;
  }

  /** Loads and validates models.yaml. Throws on any error. */
  static load(): ModelStore {
    const file = loadYamlFile(CONFIG_FILES.models, ModelsFileSchema);
    return new ModelStore(file.base_url, file.models);
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
   * key from getApiKey() is passed to the LLM client separately.
   */
  getHeaders(name: string): Record<string, string> {
    return {
      ...configuration.MODEL_HEADERS,
      ...configuration.MODEL_HEADERS_BY_NAME[normalizeEnvName(name)],
    };
  }
}
