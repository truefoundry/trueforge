import type { RemoteMcpHeaders, ResolveHeadersResult } from '@truefoundry/trueforge-core/core';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';

/**
 * Per-MCP-server request headers, keyed by server name.
 *
 * TrueForge authenticates the whole turn as one caller, so every MCP connection would otherwise
 * present that same identity. This carries the identity each individual server should see —
 * typically the end user behind the caller, for a server that resolves its own permissions.
 * An entry carrying Authorization is used instead of that server's consent flow unless rejected.
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
    throw new HTTPException(400, { message: `${X_TFG_MCP_HEADERS} must not set ${managed}` });
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

/**
 * Sends a server's caller headers over its registered auth. Caller Authorization goes out over only the
 * configured static headers, so a DCR consent flow is skipped unless the upstream rejects it.
 */
export function withCallerMcpHeaders(input: {
  callerHeaders: Record<string, string> | undefined;
  registeredHeaders: RemoteMcpHeaders;
  configuredHeaders: Record<string, string>;
}): RemoteMcpHeaders {
  const { callerHeaders, registeredHeaders, configuredHeaders } = input;
  if (callerHeaders === undefined) {
    return registeredHeaders;
  }
  if (!hasAuthorizationHeader(callerHeaders)) {
    return () => resolveWithCallerHeaders({ registeredHeaders, callerHeaders });
  }
  const headers = mergeCallerHeaders({ headers: configuredHeaders, callerHeaders });
  return () =>
    Promise.resolve({
      headers,
      onUnauthorized: () =>
        resolveWithCallerHeaders({ registeredHeaders, callerHeaders: withoutAuthorization(callerHeaders) }),
    });
}

async function resolveWithCallerHeaders(input: {
  registeredHeaders: RemoteMcpHeaders;
  callerHeaders: Record<string, string>;
}): Promise<ResolveHeadersResult> {
  const { registeredHeaders, callerHeaders } = input;
  const result = typeof registeredHeaders === 'function' ? await registeredHeaders() : { headers: registeredHeaders };
  if ('authRequired' in result) {
    return result;
  }
  return { headers: mergeCallerHeaders({ headers: result.headers, callerHeaders }) };
}

// Header names are case-insensitive, so a caller header must replace a same-named entry under any casing.
function mergeCallerHeaders(input: {
  headers: Record<string, string>;
  callerHeaders: Record<string, string>;
}): Record<string, string> {
  const callerNames = new Set(Object.keys(input.callerHeaders).map(name => name.toLowerCase()));
  return {
    ...Object.fromEntries(Object.entries(input.headers).filter(([name]) => !callerNames.has(name.toLowerCase()))),
    ...input.callerHeaders,
  };
}
