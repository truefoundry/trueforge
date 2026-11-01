import { z } from '@hono/zod-openapi';

const WebSearchConfigurationSchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether new chats may use web search. Chats that already use it keep their own setting.'),
  })
  .strict()
  .openapi('WebSearchConfiguration');

export const ConfigurationsManifestSchema = z
  .object({
    web_search: WebSearchConfigurationSchema,
  })
  .strict()
  .openapi('ConfigurationsManifest');

/** Partial so a caller may send one switch without restating the rest. */
export const ConfigurationsManifestPatchSchema =
  ConfigurationsManifestSchema.partial().openapi('ConfigurationsManifestPatch');

export const ConfigurationsSchema = z
  .object({
    manifest: ConfigurationsManifestSchema,
    updated_at: z.iso.datetime().describe('When the configurations were last saved.'),
  })
  .strict()
  .openapi('Configurations');

export const CreateOrUpdateConfigurationsSchema = z
  .object({
    manifest: ConfigurationsManifestPatchSchema,
  })
  .strict()
  .openapi('CreateOrUpdateConfigurations');

export const GetConfigurationsResponseSchema = z
  .object({
    data: ConfigurationsSchema,
  })
  .openapi('GetConfigurationsResponse');

export type ConfigurationsManifest = z.infer<typeof ConfigurationsManifestSchema>;
export type ConfigurationsManifestPatch = z.infer<typeof ConfigurationsManifestPatchSchema>;
export type Configurations = z.infer<typeof ConfigurationsSchema>;
export type CreateOrUpdateConfigurations = z.infer<typeof CreateOrUpdateConfigurationsSchema>;

/** Written the first time a tenant is read or updated, so existing tenants keep every feature on. */
export const DEFAULT_CONFIGURATIONS_MANIFEST: ConfigurationsManifest = {
  web_search: { enabled: true },
};
