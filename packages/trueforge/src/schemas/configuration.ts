import { z } from '@hono/zod-openapi';

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

const ConfigurationManifestSchema = z
  .object({
    web_search: WebSearchConfigurationSchema,
    memory: MemoryConfigurationSchema,
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
/** A tenant switch in the manifest; each one is `{ enabled }`. */
export type ConfigurationFeature = keyof ConfigurationManifest;

/**
 * Written the first time a tenant is read or updated; a stored row missing a switch gets that
 * switch's default on its next read.
 */
export const DEFAULT_CONFIGURATION_MANIFEST: ConfigurationManifest = {
  web_search: { enabled: true },
  memory: { enabled: true },
};

/**
 * Whether a stored row has every switch. Rows saved before a switch existed lack it, and a server
 * still on an older version can rewrite a row without it during a deploy.
 */
export function hasEveryConfigurationSwitch(manifest: ConfigurationManifest): boolean {
  return Object.keys(DEFAULT_CONFIGURATION_MANIFEST).every(key => key in manifest);
}
