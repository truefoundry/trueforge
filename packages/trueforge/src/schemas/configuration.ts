import { z } from '@hono/zod-openapi';

const WebSearchConfigurationSchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether new chats may use web search. Chats that already use it keep their own setting.'),
  })
  .strict()
  .openapi('WebSearchConfiguration');

const ConfigurationManifestSchema = z
  .object({
    web_search: WebSearchConfigurationSchema,
  })
  .strict()
  .openapi('ConfigurationManifest');

/** Partial so a caller may send one switch without restating the rest. */
const ConfigurationManifestPatchSchema = ConfigurationManifestSchema.partial().openapi('ConfigurationManifestPatch');

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

export type ConfigurationManifest = z.infer<typeof ConfigurationManifestSchema>;
export type ConfigurationManifestPatch = z.infer<typeof ConfigurationManifestPatchSchema>;
export type Configuration = z.infer<typeof ConfigurationSchema>;
export type UpdateConfigurationRequest = z.infer<typeof UpdateConfigurationRequestSchema>;

/** Written the first time a tenant is read or updated, so existing tenants keep every feature on. */
export const DEFAULT_CONFIGURATION_MANIFEST: ConfigurationManifest = {
  web_search: { enabled: true },
};
