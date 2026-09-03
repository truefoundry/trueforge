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

const PerServerMcpHeadersSchema = z.record(z.string().min(1), z.record(z.string().min(1), z.string()));

export type PerServerMcpHeaders = z.infer<typeof PerServerMcpHeadersSchema>;

/**
 * Absent is fine and means "no overrides". Malformed is not: the alternative to failing is running
 * a user's tool calls under the caller's own identity, which is the thing these headers exist to
 * prevent, so a bad value is rejected rather than dropped.
 */
export function parsePerServerMcpHeaders(raw: string | undefined): PerServerMcpHeaders {
  if (raw === undefined || raw.length === 0) {
    return {};
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(raw);
  } catch {
    throw new HTTPException(400, { message: `${X_TFG_MCP_HEADERS} must be a JSON object` });
  }

  const parsed = PerServerMcpHeadersSchema.safeParse(decoded);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `${X_TFG_MCP_HEADERS} must map each MCP server name to a header map`,
    });
  }
  return parsed.data;
}
