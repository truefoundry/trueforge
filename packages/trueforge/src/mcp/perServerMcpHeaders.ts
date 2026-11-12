import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

/**
 * Per-MCP-server request headers, keyed by server name.
 *
 * TrueForge authenticates the whole turn as one caller, so every MCP connection would otherwise
 * present that same identity. This carries the identity each individual server should see —
 * typically the end user behind the caller, for a server that resolves its own permissions.
 * An entry carrying Authorization is used instead of that server's consent flow unless rejected.
 * A virtual MCP's entry nests one header map per underlying server.
 */
export const X_TFG_MCP_HEADERS = 'x-tfg-mcp-headers';
const McpHeaderMapSchema = z.record(z.string().min(1), z.string());

const VirtualMcpHeadersSchema = z.record(z.string().min(1), McpHeaderMapSchema);

const PerServerMcpHeadersSchema = z.record(z.string().min(1), z.union([McpHeaderMapSchema, VirtualMcpHeadersSchema]));

export type PerServerMcpHeaders = z.infer<typeof PerServerMcpHeadersSchema>;
type VirtualMcpHeaders = z.infer<typeof VirtualMcpHeadersSchema>;

export function isVirtualMcpHeaders(entry: PerServerMcpHeaders[string]): entry is VirtualMcpHeaders {
  return Object.values(entry).some(value => typeof value === 'object');
}

/**
 * Rejects a malformed value rather than dropping it: the alternative to failing is running a user's
 * tool calls under the caller's own identity, which is the thing these headers exist to prevent.
 * An absent header is the caller's to interpret.
 */
export function parsePerServerMcpHeaders(raw: string): PerServerMcpHeaders {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch (error) {
    throw new HTTPException(400, { message: `${X_TFG_MCP_HEADERS} must be a JSON object`, cause: error });
  }

  const parsed = PerServerMcpHeadersSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `${X_TFG_MCP_HEADERS} must map each MCP server name to a header map`,
    });
  }
  return parsed.data;
}

export function hasAuthorizationHeader(headers: Record<string, string> | undefined): headers is Record<string, string> {
  return headers !== undefined && Object.keys(headers).some(name => name.toLowerCase() === 'authorization');
}

export function withoutAuthorization(headers: Record<string, string> | undefined): Record<string, string> {
  if (headers === undefined) {
    return {};
  }
  return Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== 'authorization'));
}

/** Header names are case-insensitive, so an override must replace a base entry under any casing. */
export function overrideHeaders(input: {
  base: Record<string, string>;
  override: Record<string, string>;
}): Record<string, string> {
  const overridden = new Set(Object.keys(input.override).map(name => name.toLowerCase()));
  return {
    ...Object.fromEntries(Object.entries(input.base).filter(([name]) => !overridden.has(name.toLowerCase()))),
    ...input.override,
  };
}
