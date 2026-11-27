/**
 * Shared Code Mode request/reply wire shapes (NATS body and UDS JSON).
 */
import { z } from 'zod';

export const CodeModeRequestSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('list_tools'),
    server: z.string().min(1),
  }),
  z.object({
    op: z.literal('call_tool'),
    server: z.string().min(1),
    tool: z.string().min(1),
    arguments: z.record(z.string(), z.unknown()).optional(),
  }),
  z.object({
    op: z.literal('await_approval'),
    approval_id: z.string().min(1),
  }),
]);
export type CodeModeRequest = z.infer<typeof CodeModeRequestSchema>;

/**
 * Reply to `call_tool` / `await_approval` when the call needs a user decision that has not
 * arrived yet. The client re-polls with `await_approval` until it gets a result or an error.
 */
export const CodeModeApprovalPendingSchema = z.object({
  approval_pending: z.object({
    approval_id: z.string().min(1),
  }),
});
export type CodeModeApprovalPending = z.infer<typeof CodeModeApprovalPendingSchema>;

export const CodeModeErrorSourceSchema = z.enum(['internal', 'caller', 'transport']);
export type CodeModeErrorSource = z.infer<typeof CodeModeErrorSourceSchema>;

export const CodeModeReplySchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    result: z.unknown(),
  }),
  z.object({
    ok: z.literal(false),
    error: z.string(),
    source: CodeModeErrorSourceSchema,
  }),
]);
export type CodeModeReply = z.infer<typeof CodeModeReplySchema>;
