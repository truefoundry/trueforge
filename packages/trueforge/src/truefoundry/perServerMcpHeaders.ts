import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

/**
 * Per-MCP-server request headers, keyed by server name.
 *
 * TrueForge authenticates the whole turn as one caller, so every MCP connection would otherwise
 * present that same identity. This carries the identity each individual server should see —
 * typically the end user behind the caller, for a server that resolves its own permissions.
 */
export const X_TFG_MCP_HEADERS = 'x-tfg-mcp-headers';

/** Outbound header the TrueFoundry MCP gateway reads for per-request upstream credential overrides. */
export const X_TFY_MCP_HEADERS = 'x-tfy-mcp-headers';

const PerServerMcpHeadersSchema = z.record(z.string().min(1), z.record(z.string().min(1), z.string()));

export type PerServerMcpHeaders = z.infer<typeof PerServerMcpHeadersSchema>;

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

/**
 * TrueFoundry invoke: wrap a per-server `x-tfg-mcp-headers` entry as gateway `x-tfy-mcp-headers`.
 * Back-compat: if the entry is solely that outbound header with a string value, pass it through.
 */
export function trueFoundryOutboundMcpHeaders(entry: Record<string, string> | undefined): Record<string, string> {
  if (entry === undefined) {
    return {};
  }
  const entries = Object.entries(entry);
  if (entries.length === 1) {
    const only = entries[0];
    if (only?.[0].toLowerCase() === X_TFY_MCP_HEADERS) {
      return { [X_TFY_MCP_HEADERS]: only[1] };
    }
  }
  return { [X_TFY_MCP_HEADERS]: JSON.stringify(entry) };
}
