/**
 * Scheduled agents domain + wire schemas: the `schedule.manifest` JSONB document,
 * run status/trigger vocabulary, and admin projections.
 *
 * A schedule binds an existing agent (`schedule.agent_id`) to a cron expression and
 * a task. Every fire creates a fresh session owned by `schedule.created_by` and
 * sends `manifest.task` as the first user message; the agent definition itself is
 * untouched and its version resolves at run time.
 *
 * Identity lives in columns (`id`, `tenant_id`, `agent_id`, `status`,
 * `created_by`); everything schedule-shaped lives in the Zod-validated `manifest`
 * document, so future fields (overlap policy, jitter, delivery sinks) need no
 * migration. Same pattern as `agent.manifest` and `skill.manifest`.
 */
import { z } from '@hono/zod-openapi';

/**
 * Minimum gap between two fires of one schedule.
 */
export const SCHEDULE_MIN_INTERVAL_SECONDS = 3600;

/**
 * How late a due run may still fire. A run found later than this is recorded
 * `missed` instead of executed, so a long outage does not end with the server
 * firing a stale slot.
 */
export const SCHEDULE_MAX_LATENESS_SECONDS = 3600;

/** Cron expression cannot produce a valid upcoming fire, or violates schedule policy. */
export class InvalidCronError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidCronError';
  }
}

/** `paused` stops firing and drops the pending run row; in-flight runs continue. */
export const ScheduleStatusSchema = z.enum(['active', 'paused']).openapi('ScheduleStatus');

/**
 * Standard 5-field cron (minute hour day-of-month month day-of-week).
 */
const CRON_FIELD = String.raw`[\d*,\-/]+`;
export const CronExpressionSchema = z
  .string()
  .trim()
  .regex(
    new RegExp(`^${CRON_FIELD}(?:\\s+${CRON_FIELD}){4}$`),
    'must be a 5-field cron expression: minute hour day-of-month month day-of-week',
  )
  .describe('Standard 5-field cron expression, evaluated in `timezone`.')
  .openapi('CronExpression');

/**
 * IANA zone name — never a fixed UTC offset, which cannot represent DST.
 *
 * Cron matching is literal wall-clock, so on a DST transition day a 02:30
 * schedule does not fire at all (spring forward) and a 01:30 schedule fires twice
 * (fall back). Both are accepted and documented; `schedule_run.name` derives from
 * the fire instant, so a double fire is two legitimately distinct runs.
 */
export const TimezoneSchema = z
  .string()
  .trim()
  .min(1)
  .refine(value => {
    try {
      new Intl.DateTimeFormat(undefined, { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'must be a valid IANA time zone name, e.g. "America/New_York"')
  .describe('IANA time zone the cron expression is evaluated in.')
  .openapi('Timezone');

/**
 * Wire ISO-8601 instant on a response. Always UTC with milliseconds — every
 * timestamp the server emits comes from `Date.prototype.toISOString()`.
 */
const IsoTimestamp = z.iso.datetime().openapi({ type: 'string', format: 'date-time' });

export const ScheduleTaskSchema = z
  .string()
  .trim()
  .min(1)
  .describe('First user message sent to the agent on every run.');

/** Schedule document persisted as `schedule.manifest`. */
export const ScheduleManifestObjectSchema = z
  .object({
    task: ScheduleTaskSchema,
    cron: CronExpressionSchema,
    timezone: TimezoneSchema,
  })
  .strict();

export const ScheduleManifestSchema = ScheduleManifestObjectSchema.openapi('ScheduleManifest');

/** Admin/settings wire view: identity columns plus the nested manifest. */
export const ConfiguredScheduleSchema = z
  .object({
    id: z.string(),
    agent_id: z.string(),
    manifest: ScheduleManifestSchema,
    status: ScheduleStatusSchema,
    created_by: z.string(),
    created_at: IsoTimestamp,
    updated_at: IsoTimestamp,
  })
  .strict()
  .openapi('ConfiguredSchedule');

export const CreateScheduleRequestSchema = z
  .object({
    agent_id: z.string().min(1),
    manifest: ScheduleManifestSchema,
  })
  .strict()
  .openapi('CreateScheduleRequest');

/**
 * Agent binding is immutable — a schedule that should point at a different agent
 * is a different schedule. Status changes go through pause/resume, not here.
 */
export const UpdateScheduleRequestSchema = z
  .object({
    manifest: ScheduleManifestSchema,
  })
  .strict()
  .openapi('UpdateScheduleRequest');



export const GetScheduleResponseSchema = z.object({ data: ConfiguredScheduleSchema }).openapi('GetScheduleResponse');
export const ListSchedulesResponseSchema = z
  .object({ data: z.array(ConfiguredScheduleSchema) })
  .openapi('ListSchedulesResponse');
export const DeleteScheduleResponseSchema = z.object({}).openapi('DeleteScheduleResponse');

export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;
export type ScheduleManifest = z.infer<typeof ScheduleManifestSchema>;
export type ConfiguredSchedule = z.infer<typeof ConfiguredScheduleSchema>;
export type CreateScheduleRequest = z.infer<typeof CreateScheduleRequestSchema>;
export type UpdateScheduleRequest = z.infer<typeof UpdateScheduleRequestSchema>;
