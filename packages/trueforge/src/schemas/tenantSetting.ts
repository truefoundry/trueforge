import { z } from '@hono/zod-openapi';

const TenantWebSearchSettingSchema = z
  .object({
    enabled: z
      .boolean()
      .describe('Whether new chats may use web search. Chats that already use it keep their own setting.'),
  })
  .strict()
  .openapi('TenantWebSearchSetting');

export const TenantSettingManifestSchema = z
  .object({
    web_search: TenantWebSearchSettingSchema,
  })
  .strict()
  .openapi('TenantSettingManifest');

export const TenantSettingSchema = z
  .object({
    manifest: TenantSettingManifestSchema,
  })
  .strict()
  .openapi('TenantSetting');

export const UpdateTenantSettingRequestSchema = z
  .object({
    manifest: TenantSettingManifestSchema,
  })
  .strict()
  .openapi('UpdateTenantSettingRequest');

export const GetTenantSettingResponseSchema = z
  .object({
    data: TenantSettingSchema,
  })
  .openapi('GetTenantSettingResponse');

export type TenantSettingManifest = z.infer<typeof TenantSettingManifestSchema>;
export type TenantSetting = z.infer<typeof TenantSettingSchema>;
export type UpdateTenantSettingRequest = z.infer<typeof UpdateTenantSettingRequestSchema>;

/** Applied when a tenant has no row yet, so existing tenants keep every feature on. */
export const DEFAULT_TENANT_SETTING_MANIFEST: TenantSettingManifest = {
  web_search: { enabled: true },
};
