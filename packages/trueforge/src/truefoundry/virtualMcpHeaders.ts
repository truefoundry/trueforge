import { z } from 'zod';
import { decodePerServerMcpHeaders, McpHeaderMapSchema } from '../runtime/perServerMcpHeaders';

/** A virtual MCP's `x-tfg-mcp-headers` entry: one header map per underlying server. */
const VirtualMcpHeadersSchema = z.record(z.string().min(1), McpHeaderMapSchema);

const TrueFoundryPerServerMcpHeadersSchema = z.record(
  z.string().min(1),
  z.union([McpHeaderMapSchema, VirtualMcpHeadersSchema]),
);

export type TrueFoundryPerServerMcpHeaders = z.infer<typeof TrueFoundryPerServerMcpHeadersSchema>;

export function parseTrueFoundryPerServerMcpHeaders(raw: string): TrueFoundryPerServerMcpHeaders {
  return decodePerServerMcpHeaders({ raw, schema: TrueFoundryPerServerMcpHeadersSchema });
}
