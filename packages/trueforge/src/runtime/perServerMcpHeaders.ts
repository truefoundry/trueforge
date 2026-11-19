import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

/**
 * Per-MCP-server request headers, keyed by server name.
 *
 * TrueForge authenticates the whole turn as one caller, so every MCP connection would otherwise
 * present that same identity. This carries the identity each individual server should see —
 * typically the end user behind the caller, for a server that resolves its own permissions.
 * An entry carrying Authorization is used instead of that server's consent flow.
 */
export const X_TFG_MCP_HEADERS = 'x-tfg-mcp-headers';
export const McpHeaderMapSchema = z.record(z.string().min(1), z.string());

const PerServerMcpHeadersSchema = z.record(z.string().min(1), McpHeaderMapSchema);

export type PerServerMcpHeaders = z.infer<typeof PerServerMcpHeadersSchema>;

// Transport headers TrueForge manages; a caller value would replace them in the MCP client.
const MANAGED_MCP_HEADERS = new Set(['mcp-session-id', 'mcp-protocol-version']);

export function parsePerServerMcpHeaders(raw: string): PerServerMcpHeaders {
  return decodePerServerMcpHeaders({ raw, schema: PerServerMcpHeadersSchema });
}

/**
 * Rejects a malformed value rather than dropping it: the alternative to failing is running a user's
 * tool calls under the caller's own identity, which is the thing these headers exist to prevent.
 * An absent header is the caller's to interpret.
 */
export function decodePerServerMcpHeaders<T extends Record<string, Record<string, unknown>>>(input: {
  raw: string;
  schema: z.ZodType<T>;
}): T {
  let decoded: unknown;
  try {
    decoded = JSON.parse(input.raw);
  } catch (error) {
    throw new HTTPException(400, { message: `${X_TFG_MCP_HEADERS} must be a JSON object`, cause: error });
  }

  const parsed = input.schema.safeParse(decoded);
  if (!parsed.success) {
    throw new HTTPException(400, {
      message: `${X_TFG_MCP_HEADERS} must map each MCP server name to a header map`,
    });
  }
  const managed = Object.values(parsed.data)
    .flatMap(entry => Object.keys(entry))
    .find(name => MANAGED_MCP_HEADERS.has(name.toLowerCase()));
  if (managed !== undefined) {
    throw new HTTPException(400, {
      message: `${X_TFG_MCP_HEADERS} must not have keys as one of ${[...MANAGED_MCP_HEADERS].join(', ')} (got ${managed})`,
    });
  }
  return parsed.data;
}

export function hasAuthorizationHeader(headers: Record<string, string>): boolean {
  return Object.keys(headers).some(name => name.toLowerCase() === 'authorization');
}

/** Header names are case-insensitive, so an override replaces a same-named base entry under any casing. */
export function mergeServerHeaders(input: {
  base: Record<string, string>;
  override: Record<string, string>;
}): Record<string, string> {
  const overrideNames = new Set(Object.keys(input.override).map(name => name.toLowerCase()));
  return {
    ...Object.fromEntries(Object.entries(input.base).filter(([name]) => !overrideNames.has(name.toLowerCase()))),
    ...input.override,
  };
}
