import { z } from '@hono/zod-openapi';

const WebSearchSettingsSchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether new chats may use web search. Chats that already use it keep their own setting.'),
  })
  .strict()
  .openapi('WebSearchSettings');

export const SettingsManifestSchema = z
  .object({
    web_search: WebSearchSettingsSchema,
  })
  .strict()
  .openapi('SettingsManifest');

/** Partial so a caller may send one switch without restating the rest. */
export const SettingsManifestPatchSchema = SettingsManifestSchema.partial().openapi('SettingsManifestPatch');

export const SettingsSchema = z
  .object({
    manifest: SettingsManifestSchema,
    updated_at: z.iso.datetime().describe('When the settings were last saved.'),
  })
  .strict()
  .openapi('Settings');

export const CreateOrUpdateSettingsSchema = z
  .object({
    manifest: SettingsManifestPatchSchema,
  })
  .strict()
  .openapi('CreateOrUpdateSettings');

export const GetSettingsResponseSchema = z
  .object({
    data: SettingsSchema,
  })
  .openapi('GetSettingsResponse');

export type SettingsManifest = z.infer<typeof SettingsManifestSchema>;
export type SettingsManifestPatch = z.infer<typeof SettingsManifestPatchSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type CreateOrUpdateSettings = z.infer<typeof CreateOrUpdateSettingsSchema>;

/** Written the first time a tenant is read or updated, so existing tenants keep every feature on. */
export const DEFAULT_SETTINGS_MANIFEST: SettingsManifest = {
  web_search: { enabled: true },
};
