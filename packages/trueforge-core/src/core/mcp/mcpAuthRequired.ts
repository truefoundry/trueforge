import type { MCPAuthRequired } from './IMCPServer.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function stringRecordFromUnknown(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }
  const urls: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string' && entry.length > 0) {
      urls[key] = entry;
    }
  }
  return Object.keys(urls).length > 0 ? urls : undefined;
}

/**
 * Parse a gateway (or compatible) 401 JSON body for outbound OAuth consent URLs.
 * Shape: `{ error: { type: "McpAuthRequiredError" }, authorization_urls: { name: url } }`.
 */
export function authorizationUrlsFromBody(body: unknown): Record<string, string> | undefined {
  if (!isPlainObject(body)) {
    return undefined;
  }
  const error = body.error;
  let errorType: unknown;
  let urlsFromError: unknown;
  if (isPlainObject(error)) {
    errorType = error.type;
    urlsFromError = error.authorization_urls;
  } else {
    errorType = body.type;
  }
  const urls = stringRecordFromUnknown(body.authorization_urls) ?? stringRecordFromUnknown(urlsFromError);
  if (urls === undefined) {
    return undefined;
  }
  if (errorType !== undefined && errorType !== 'McpAuthRequiredError') {
    return undefined;
  }
  return urls;
}

/** Pull a JSON object out of an error message that embeds the response body. */
export function authorizationUrlsFromErrorMessage(message: string): Record<string, string> | undefined {
  const start = message.indexOf('{');
  const end = message.lastIndexOf('}');
  if (start < 0 || end <= start) {
    return undefined;
  }
  try {
    return authorizationUrlsFromBody(JSON.parse(message.slice(start, end + 1)));
  } catch {
    return undefined;
  }
}

export function authorizationUrlsFromUnknownError(error: unknown): Record<string, string> | undefined {
  if (typeof error === 'object' && error !== null && 'authorizationUrls' in error) {
    const urls = error.authorizationUrls;
    if (isPlainObject(urls)) {
      const parsed = stringRecordFromUnknown(urls);
      if (parsed !== undefined) {
        return parsed;
      }
    }
  }
  if (error instanceof Error) {
    const fromMessage = authorizationUrlsFromErrorMessage(error.message);
    if (fromMessage !== undefined) {
      return fromMessage;
    }
    if (error.cause !== undefined) {
      return authorizationUrlsFromUnknownError(error.cause);
    }
  }
  return undefined;
}

export function mcpAuthRequiredForServer(input: {
  authorizationUrls: Record<string, string>;
  serverId: string;
  serverName: string;
}): MCPAuthRequired | undefined {
  const authUrl =
    input.authorizationUrls[input.serverName] ??
    input.authorizationUrls[input.serverId] ??
    Object.values(input.authorizationUrls)[0];
  if (authUrl === undefined || authUrl.length === 0) {
    return undefined;
  }
  return {
    servers: [{ id: input.serverId, name: input.serverName, auth_url: authUrl }],
  };
}
