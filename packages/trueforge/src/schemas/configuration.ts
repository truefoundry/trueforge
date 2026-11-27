import { z } from '@hono/zod-openapi';
import { MAX_AUTO_CANDIDATE_MODELS, MIN_AUTO_CANDIDATE_MODELS, parseModelFqn } from '@truefoundry/trueforge-core/core';

const WebSearchConfigurationSchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether new chats may use web search. Chats that already use it keep their own setting.'),
  })
  .strict()
  .openapi('WebSearchConfiguration');

const MemoryConfigurationSchema = z
  .object({
    enabled: z.boolean().describe('Whether agents in this tenant may remember details from past chats.'),
  })
  .strict()
  .openapi('MemoryConfiguration');

const AutoModelRoutingEnabledSchema = z
  .boolean()
  .describe('Whether this tenant may use auto model routing, which picks a model for each turn and each subagent.');

const AutoModelRoutingCandidateModelsBaseSchema = z
  .array(z.string().refine(name => parseModelFqn(name) !== undefined, 'Use the full model name, account/model.'))
  .max(MAX_AUTO_CANDIDATE_MODELS);

const MIN_CANDIDATE_MODELS_MESSAGE = `Choose at least ${String(MIN_AUTO_CANDIDATE_MODELS)} models.`;

/** Stored value: empty until an admin picks models. */
const AutoModelRoutingCandidateModelsSchema = AutoModelRoutingCandidateModelsBaseSchema.describe(
  `Full names (account/model) of ${String(MIN_AUTO_CANDIDATE_MODELS)} to ${String(MAX_AUTO_CANDIDATE_MODELS)} models auto routing may pick from. Empty until models are chosen.`,
);

/** Updates must choose a valid list; the list cannot be cleared. */
const AutoModelRoutingCandidateModelsPatchSchema = AutoModelRoutingCandidateModelsBaseSchema.refine(
  names => new Set(names).size >= MIN_AUTO_CANDIDATE_MODELS,
  MIN_CANDIDATE_MODELS_MESSAGE,
).describe(
  `Full names (account/model) of ${String(MIN_AUTO_CANDIDATE_MODELS)} to ${String(MAX_AUTO_CANDIDATE_MODELS)} models auto routing may pick from.`,
);

const AutoModelRoutingConfigurationSchema = z
  .object({
    enabled: AutoModelRoutingEnabledSchema,
    candidate_models: AutoModelRoutingCandidateModelsSchema,
  })
  .strict()
  .openapi('AutoModelRoutingConfiguration');

/** Both fields are optional; a field left out keeps its stored value. */
const AutoModelRoutingConfigurationPatchSchema = z
  .object({
    enabled: AutoModelRoutingEnabledSchema.optional(),
    candidate_models: AutoModelRoutingCandidateModelsPatchSchema.optional(),
  })
  .strict()
  .openapi('AutoModelRoutingConfigurationPatch');

const ConfigurationManifestSchema = z
  .object({
    web_search: WebSearchConfigurationSchema,
    memory: MemoryConfigurationSchema,
    auto_model_routing: AutoModelRoutingConfigurationSchema,
  })
  .strict()
  .openapi('ConfigurationManifest');

/** Partial so a caller may send one switch without restating the rest. */
const ConfigurationManifestPatchSchema = ConfigurationManifestSchema.partial()
  .extend({ auto_model_routing: AutoModelRoutingConfigurationPatchSchema.optional() })
  .openapi('ConfigurationManifestPatch');

const ConfigurationSchema = z
  .object({
    manifest: ConfigurationManifestSchema,
    updated_at: z.iso.datetime().describe('When the configuration was last saved.'),
  })
  .strict()
  .openapi('Configuration');

export const UpdateConfigurationRequestSchema = z
  .object({
    manifest: ConfigurationManifestPatchSchema,
  })
  .strict()
  .openapi('UpdateConfigurationRequest');

export const GetConfigurationResponseSchema = z
  .object({
    data: ConfigurationSchema,
  })
  .openapi('GetConfigurationResponse');

export type AutoModelRoutingConfiguration = z.infer<typeof AutoModelRoutingConfigurationSchema>;
export type AutoModelRoutingConfigurationPatch = z.infer<typeof AutoModelRoutingConfigurationPatchSchema>;
export type ConfigurationManifest = z.infer<typeof ConfigurationManifestSchema>;
export type ConfigurationManifestPatch = z.infer<typeof ConfigurationManifestPatchSchema>;
export type Configuration = z.infer<typeof ConfigurationSchema>;
export type UpdateConfigurationRequest = z.infer<typeof UpdateConfigurationRequestSchema>;
/** A tenant switch in the manifest; each one is `{ enabled }`. */
export type ConfigurationFeature = keyof ConfigurationManifest;

/**
 * Written the first time a tenant is read or updated; a stored row missing a switch gets that
 * switch's default on its next read.
 */
export const DEFAULT_CONFIGURATION_MANIFEST: ConfigurationManifest = {
  web_search: { enabled: true },
  memory: { enabled: true },
  auto_model_routing: { enabled: true, candidate_models: [] },
};

/**
 * Whether a stored row has every switch. Rows saved before a switch existed lack it, and a server
 * still on an older version can rewrite a row without it during a deploy.
 */
export function hasEveryConfigurationSwitch(manifest: ConfigurationManifest): boolean {
  return (
    Object.keys(DEFAULT_CONFIGURATION_MANIFEST).every(key => key in manifest) &&
    // Rows saved with only the Auto switch lack its model list.
    Object.keys(DEFAULT_CONFIGURATION_MANIFEST.auto_model_routing).every(key => key in manifest.auto_model_routing)
  );
}
