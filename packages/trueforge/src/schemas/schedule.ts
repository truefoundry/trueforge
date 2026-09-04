import { z } from '@hono/zod-openapi';
import { CreatedBySubjectSchema, TokenPaginationSchema } from '@truefoundry/trueforge-core/agent-session';
import { AgentNameSchema, NameSchema } from './common';

/**
 * Minimum gap between two triggers of one schedule.
 */
export const SCHEDULE_MIN_INTERVAL_SECONDS = 3600;

/**
 * Standard 5-field cron (minute hour day-of-month month day-of-week).
 */
const CRON_FIELD = String.raw`[\d*,\-/]+`;

/** Cron expression cannot produce a valid upcoming trigger, or violates schedule policy. */
export class InvalidCronError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'InvalidCronError';
  }
}

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
 * Optional in the manifest; defaults to UTC, which is also the recommendation when
 * the trigger instant matters more than the local hour.
 *
 * Cron is evaluated in this zone via `cron-parser`: a spring-forward gap maps a
 * missing local time onto the landing hour, and fall-back does not double-fire a
 * fixed hour. Prefer `UTC` when the trigger instant matters more than the local hour.
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

const NullableIsoTimestamp = z.iso
  .datetime()
  .nullable()
  .openapi({ type: ['string', 'null'], format: 'date-time' });

export const ScheduleTaskSchema = z
  .string()
  .trim()
  .min(1)
  .describe('First user message sent to the agent on every run.');

export const ScheduleStatusSchema = z.enum(['active', 'paused']).openapi('ScheduleStatus');

/**
 * Schedule document persisted as `schedule.manifest`.
 */
export const ScheduleManifestObjectSchema = z
  .object({
    task: ScheduleTaskSchema,
    cron: CronExpressionSchema,
    timezone: TimezoneSchema.default('UTC'),
    status: ScheduleStatusSchema.default('active'),
  })
  .strict();

export const ScheduleManifestSchema = ScheduleManifestObjectSchema.openapi('ScheduleManifest');

/** List/get/create/update response item. */
export const ScheduleSchema = z
  .object({
    id: z.string(),
    agent_name: AgentNameSchema,
    name: NameSchema,
    manifest: ScheduleManifestSchema,
    created_by_subject: CreatedBySubjectSchema,
    created_at: IsoTimestamp,
    updated_at: IsoTimestamp,
  })
  .strict()
  .openapi('Schedule');

export const CreateScheduleRequestSchema = z
  .object({
    agent_name: AgentNameSchema,
    name: NameSchema,
    manifest: ScheduleManifestSchema,
  })
  .strict()
  .openapi('CreateScheduleRequest');

export const UpdateScheduleRequestSchema = z
  .object({
    name: NameSchema,
    manifest: ScheduleManifestSchema,
  })
  .strict()
  .openapi('UpdateScheduleRequest');

export const GetScheduleResponseSchema = z.object({ data: ScheduleSchema }).openapi('GetScheduleResponse');
export const ListSchedulesResponseSchema = z
  .object({
    data: z.array(ScheduleSchema),
    pagination: TokenPaginationSchema,
  })
  .openapi('ListSchedulesResponse');
export const DeleteScheduleResponseSchema = z.object({}).openapi('DeleteScheduleResponse');

/**
 * Run lifecycle.
 * - `scheduled`  the one pending run; at most one per schedule, enforced by
 *                `schedule_run_pending_uq`
 * - `triggered`  taken by dispatch via `updateRunStatus`
 * - `failed`     errored, or hand-off to the executor failed
 */
export const ScheduleRunStatusSchema = z.enum(['scheduled', 'triggered', 'failed']).openapi('ScheduleRunStatus');

export const ScheduleRunSchema = z
  .object({
    id: z.string(),
    schedule_id: z.string(),
    name: z.string(),
    scheduled_for: IsoTimestamp,
    status: ScheduleRunStatusSchema,
    created_by_subject: CreatedBySubjectSchema,
    triggered_at: NullableIsoTimestamp,
    created_at: IsoTimestamp,
    updated_at: IsoTimestamp,
  })
  .strict()
  .openapi('ScheduleRun');

export const ListScheduleRunsResponseSchema = z
  .object({ data: z.array(ScheduleRunSchema) })
  .openapi('ListScheduleRunsResponse');

/**
 * Identify the schedule to run. Task always comes from the schedule manifest.
 */
export const CreateScheduleRunRequestSchema = z
  .object({
    schedule_id: z.string().min(1).max(64).describe('Immutable schedule identifier.'),
  })
  .strict()
  .describe('Trigger an immediate run for the given schedule. The task is taken from the schedule manifest.')
  .openapi('CreateScheduleRunRequest');

export const CreateScheduleRunResponseSchema = z
  .object({ data: ScheduleRunSchema })
  .openapi('CreateScheduleRunResponse');

export type ScheduleStatus = z.infer<typeof ScheduleStatusSchema>;
export type ScheduleRunStatus = z.infer<typeof ScheduleRunStatusSchema>;
export type ScheduleManifest = z.infer<typeof ScheduleManifestSchema>;
export type Schedule = z.infer<typeof ScheduleSchema>;
export type ScheduleRun = z.infer<typeof ScheduleRunSchema>;
export type CreateScheduleRequest = z.infer<typeof CreateScheduleRequestSchema>;
export type UpdateScheduleRequest = z.infer<typeof UpdateScheduleRequestSchema>;
export type CreateScheduleRunRequest = z.infer<typeof CreateScheduleRunRequestSchema>;
