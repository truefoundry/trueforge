/** Wire schemas for POST /api/internal/list-permissions. */
import { z } from '@hono/zod-openapi';

export const PermissionResourceTypeSchema = z
  .enum(['agent', 'schedule', 'session'])
  .describe('Resource kind to evaluate permissions for.')
  .openapi('PermissionResourceType');

export const ResourcePermissionSchema = z
  .enum(['MANAGE', 'DELETE'])
  .describe('Granted action on a resource. MANAGE covers update and other non-delete mutations.')
  .openapi('ResourcePermission');

export const ListPermissionsRequestSchema = z
  .object({
    resource_type: PermissionResourceTypeSchema,
    resource_ids: z
      .array(z.string().min(1))
      .max(100)
      .describe('Resource ids of `resource_type` to evaluate for the caller.'),
  })
  .openapi('ListPermissionsRequest');

export const ListPermissionsResponseSchema = z
  .object({
    data: z
      .record(z.string(), z.array(ResourcePermissionSchema))
      .describe('Permissions granted to the caller, keyed by resource id. Missing or inaccessible ids are `[]`.'),
  })
  .openapi('ListPermissionsResponse');

export type PermissionResourceType = z.infer<typeof PermissionResourceTypeSchema>;
export type ResourcePermission = z.infer<typeof ResourcePermissionSchema>;
export type ListPermissionsRequest = z.infer<typeof ListPermissionsRequestSchema>;
export type ListPermissionsResponse = z.infer<typeof ListPermissionsResponseSchema>;

/** Owner grant used for standalone/OIDC agents and for all session/schedule checks. */
export const OWNER_RESOURCE_PERMISSIONS: readonly ResourcePermission[] = ['MANAGE', 'DELETE'];

/** Response scaffold: every requested id starts with no grants. */
export function emptyPermissionsByResourceId(resourceIds: readonly string[]): Record<string, ResourcePermission[]> {
  return Object.fromEntries(resourceIds.map(id => [id, [] as ResourcePermission[]]));
}
