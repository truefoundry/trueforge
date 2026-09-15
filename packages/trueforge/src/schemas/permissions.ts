/** Wire schemas for POST /api/internal/list-permissions. */
import { z } from '@hono/zod-openapi';

export const PermissionResourceTypeSchema = z
  .enum(['agent', 'schedule', 'session', 'tenant'])
  .describe('Resource type to evaluate permissions for.')
  .openapi('PermissionResourceType');

export const AgentResourcePermissionSchema = z
  .enum(['USE', 'MANAGE', 'DELETE'])
  .describe('Granted action on an agent.')
  .openapi('AgentResourcePermission');

export const ScheduleResourcePermissionSchema = z
  .enum(['MANAGE', 'DELETE'])
  .describe('Granted action on a schedule.')
  .openapi('ScheduleResourcePermission');

export const SessionResourcePermissionSchema = z
  .enum(['MANAGE', 'DELETE'])
  .describe('Granted action on a session.')
  .openapi('SessionResourcePermission');

/** Tenant-scoped create actions (keys are entity kinds, e.g. `agent`). */
export const TenantCreatePermissionSchema = z
  .enum(['CREATE'])
  .describe('Granted create action on a tenant-scoped entity kind.')
  .openapi('TenantCreatePermission');

/** Any permission that may appear in a list-permissions response. */
export const ResourcePermissionSchema = z
  .enum(['USE', 'MANAGE', 'DELETE', 'CREATE'])
  .describe('Granted action on a resource id or tenant entity kind.')
  .openapi('ResourcePermission');

export const ListPermissionsRequestSchema = z
  .object({
    resource_type: PermissionResourceTypeSchema,
    resource_ids: z.array(z.string().min(1)).max(100).describe('Resource ids of `resource_type` to evaluate.'),
  })
  .openapi('ListPermissionsRequest');

export const ListPermissionsDataSchema = z
  .object({
    type: PermissionResourceTypeSchema,
    permissions: z
      .record(z.string(), z.array(ResourcePermissionSchema))
      .describe(
        'For agent/schedule/session: keyed by resource id. For tenant: keyed by entity kind (e.g. `agent` → `CREATE`).',
      ),
  })
  .openapi('ListPermissionsData');

export const ListPermissionsResponseSchema = z
  .object({
    data: ListPermissionsDataSchema,
  })
  .openapi('ListPermissionsResponse');

export type PermissionResourceType = z.infer<typeof PermissionResourceTypeSchema>;
export type AgentResourcePermission = z.infer<typeof AgentResourcePermissionSchema>;
export type ScheduleResourcePermission = z.infer<typeof ScheduleResourcePermissionSchema>;
export type SessionResourcePermission = z.infer<typeof SessionResourcePermissionSchema>;
export type TenantCreatePermission = z.infer<typeof TenantCreatePermissionSchema>;
export type ResourcePermission = z.infer<typeof ResourcePermissionSchema>;
export type ListPermissionsRequest = z.infer<typeof ListPermissionsRequestSchema>;
export type ListPermissionsData = z.infer<typeof ListPermissionsDataSchema>;
export type ListPermissionsResponse = z.infer<typeof ListPermissionsResponseSchema>;

export const AGENT_USE_PERMISSIONS = [AgentResourcePermissionSchema.enum.USE] as const;
export const AGENT_OWNER_PERMISSIONS = AgentResourcePermissionSchema.options;
export const SCHEDULE_OWNER_PERMISSIONS = ScheduleResourcePermissionSchema.options;
export const SESSION_OWNER_PERMISSIONS = SessionResourcePermissionSchema.options;
export const TENANT_CREATE_AGENT_PERMISSIONS = [TenantCreatePermissionSchema.enum.CREATE] as const;

/** Response scaffold: every requested id starts with no grants. */
export function emptyPermissionsByResourceId(resourceIds: readonly string[]): Record<string, ResourcePermission[]> {
  return Object.fromEntries(resourceIds.map(id => [id, [] as ResourcePermission[]]));
}

export function listPermissionsData(
  type: PermissionResourceType,
  permissions: Record<string, ResourcePermission[]>,
): ListPermissionsData {
  return { type, permissions };
}
