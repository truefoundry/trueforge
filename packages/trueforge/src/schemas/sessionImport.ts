/**
 * Wire schema for POST /api/v1/settings/sessions/import (one-shot ops backfill).
 * Loose validation — caller (k8s-controller) owns massaging.
 */
import { z } from '@hono/zod-openapi';

export const ImportSessionSnapshotRequestSchema = z
  .object({
    session: z
      .object({
        session_id: z.string().min(1),
        tenant_id: z.string().min(1),
        created_by: z.string().min(1),
        agent_spec: z.record(z.string(), z.unknown()),
        title: z.string().nullable(),
        last_turn_id: z.string().nullable(),
        custom: z.record(z.string(), z.unknown()).nullable(),
        last_activity_timestamp_ms: z.number(),
        created_at: z.string().min(1),
        updated_at: z.string().min(1),
      })
      .loose(),
    turns: z
      .array(
        z
          .object({
            turn_id: z.string().min(1),
            first_turn_id: z.string().min(1),
            previous_turn_id: z.string().nullable(),
            ancestor_ids: z.array(z.string()),
            input: z.array(z.unknown()),
            state: z.unknown(),
            checkpoint: z.object({
              mcp_servers: z.unknown().nullable(),
              sandbox_info: z.unknown().nullable(),
            }),
            custom: z.record(z.string(), z.unknown()).nullable(),
            created_at: z.string().min(1),
            updated_at: z.string().min(1),
            threads: z.array(
              z
                .object({
                  thread_id: z.string().min(1),
                  context: z.array(z.unknown()),
                  current_context_usage: z.unknown(),
                  parent: z.unknown().nullable(),
                  completion: z.unknown().nullable(),
                  agent_info: z.unknown().nullable(),
                  capability_state: z.record(z.string(), z.unknown()).nullable(),
                })
                .loose(),
            ),
            events: z.array(
              z
                .object({
                  id: z.string().min(1),
                  created_at: z.string().min(1),
                })
                .loose(),
            ),
          })
          .loose(),
      )
      .min(1),
  })
  .openapi('ImportSessionSnapshotRequest');

export const ImportSessionSnapshotResultSchema = z
  .object({
    imported: z.boolean(),
    session_id: z.string(),
  })
  .openapi('ImportSessionSnapshotResult');

export const ImportSessionSnapshotResponseSchema = z
  .object({
    data: ImportSessionSnapshotResultSchema,
  })
  .openapi('ImportSessionSnapshotResponse');

export type ImportSessionSnapshotRequest = z.infer<typeof ImportSessionSnapshotRequestSchema>;
export type ImportSessionSnapshotResult = z.infer<typeof ImportSessionSnapshotResultSchema>;
export type ImportSessionSnapshotResponse = z.infer<typeof ImportSessionSnapshotResponseSchema>;
