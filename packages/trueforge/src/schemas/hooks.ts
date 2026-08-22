/**
 * hooks.json schemas — operator-configured lifecycle hooks (docs/key-features/hooks).
 * The file is trusted operator configuration read from disk at startup, not an
 * API surface; external tools (security integrations) may write it, which is
 * why unknown event keys are tolerated rather than rejected.
 */
import { z } from '@hono/zod-openapi';

export const HOOK_EVENT_NAMES = ['user_prompt_submit', 'pre_tool_use', 'post_tool_use', 'turn_done'] as const;

export type HookEventName = (typeof HOOK_EVENT_NAMES)[number];

export const DEFAULT_HOOK_TIMEOUT_MS = 30_000;
const MAX_HOOK_TIMEOUT_MS = 600_000;

export const HookCommandSchema = z
  .object({
    type: z.literal('command').describe('Hook kind; `command` is the only kind today.'),
    command: z
      .string()
      .min(1)
      .describe('Command line run with the system shell; the event payload arrives as JSON on stdin.'),
    timeout_ms: z
      .number()
      .int()
      .positive()
      .max(MAX_HOOK_TIMEOUT_MS)
      .default(DEFAULT_HOOK_TIMEOUT_MS)
      .describe('Milliseconds before the command is killed and fail_mode applies.'),
    fail_mode: z
      .enum(['open', 'closed'])
      .default('open')
      .describe('Outcome when the command fails or times out: open = allow, closed = deny.'),
  })
  .strict();

const HookEntriesSchema = z.array(HookCommandSchema).default([]);

export const HooksFileSchema = z
  .object({
    version: z.literal(1),
    hooks: z
      .object({
        user_prompt_submit: HookEntriesSchema,
        pre_tool_use: HookEntriesSchema,
        post_tool_use: HookEntriesSchema,
        turn_done: HookEntriesSchema,
      })
      // Unknown event keys are ignored (with a load-time warning), so a file
      // written for a newer server does not fail startup on an older one.
      .catchall(z.unknown()),
  })
  .strict();

export type HookCommand = z.infer<typeof HookCommandSchema>;
export type HooksFile = z.infer<typeof HooksFileSchema>;
