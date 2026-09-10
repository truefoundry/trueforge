/** Wire schemas for POST /api/internal/list-permissions. */
import { z } from '@hono/zod-openapi';

export const PermissionResourceTypeSchema = z
  .enum(['agent', 'schedule', 'session'])
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

/** Any permission that may appear in a list-permissions response. */
export const ResourcePermissionSchema = z
  .enum(['USE', 'MANAGE', 'DELETE'])
  .describe('Granted action on a resource.')
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
export type AgentResourcePermission = z.infer<typeof AgentResourcePermissionSchema>;
export type ScheduleResourcePermission = z.infer<typeof ScheduleResourcePermissionSchema>;
export type SessionResourcePermission = z.infer<typeof SessionResourcePermissionSchema>;
export type ResourcePermission = z.infer<typeof ResourcePermissionSchema>;
export type ListPermissionsRequest = z.infer<typeof ListPermissionsRequestSchema>;
export type ListPermissionsResponse = z.infer<typeof ListPermissionsResponseSchema>;

export const AGENT_USE_PERMISSIONS = [AgentResourcePermissionSchema.enum.USE] as const;
export const AGENT_OWNER_PERMISSIONS = AgentResourcePermissionSchema.options;
export const SCHEDULE_OWNER_PERMISSIONS = ScheduleResourcePermissionSchema.options;
export const SESSION_OWNER_PERMISSIONS = SessionResourcePermissionSchema.options;

/** Response scaffold: every requested id starts with no grants. */
export function emptyPermissionsByResourceId(resourceIds: readonly string[]): Record<string, ResourcePermission[]> {
  return Object.fromEntries(resourceIds.map(id => [id, [] as ResourcePermission[]]));
}
