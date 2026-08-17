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
]);
export type CodeModeRequest = z.infer<typeof CodeModeRequestSchema>;

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
