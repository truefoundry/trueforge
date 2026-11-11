import type { TrueForge } from '@truefoundry/trueforge-sdk';
import type { McpToolDescriptor } from './openApiTools';

export class WireApiError extends Error {
  readonly statusCode: number;
  readonly body: unknown;

  constructor(statusCode: number, body: unknown) {
    super(`TrueForge API request failed with status ${String(statusCode)}`);
    this.name = 'WireApiError';
    this.statusCode = statusCode;
    this.body = body;
  }
}

function parameterValue(value: unknown, label: string): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw new Error(`${label} must be a string, number, or boolean`);
}

function queryValue(value: unknown, name: string): string[] {
  if (Array.isArray(value)) {
    return value.map(item => parameterValue(item, `Query parameter ${name}`));
  }
  return [parameterValue(value, `Query parameter ${name}`)];
}

function responseBody(text: string): unknown {
  if (text.length === 0) {
    return {};
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { error: { message: 'The TrueForge API returned a non-JSON response.' } };
  }
}

export interface WireApiClient {
  execute(descriptor: McpToolDescriptor, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}

/**
 * The SDK passthrough fetch appends a relative path onto the base URL's pathname, which
 * percent-encodes `?`. Split the query off so it stays a query string.
 */
function resolveWireUrl(baseUrl: string, pathAndQuery: string): string {
  const queryIndex = pathAndQuery.indexOf('?');
  const path = queryIndex === -1 ? pathAndQuery : pathAndQuery.slice(0, queryIndex);
  const search = queryIndex === -1 ? '' : pathAndQuery.slice(queryIndex + 1);
  const url = new URL(baseUrl);
  const basePath = url.pathname.endsWith('/') ? url.pathname.slice(0, -1) : url.pathname;
  const relative = path.startsWith('/') ? path : `/${path}`;
  url.pathname = `${basePath === '/' ? '' : basePath}${relative}`;
  url.search = search;
  url.hash = '';
  return url.toString();
}

/** Map generated tool arguments onto raw SDK passthrough requests. */
export function createWireApiClient(client: Pick<TrueForge, 'fetch'>, baseUrl: string): WireApiClient {
  return {
    async execute(descriptor, args, signal) {
      let pathname = descriptor.path;
      for (const name of descriptor.pathParameters) {
        const value = args[name];
        if (value === undefined) {
          throw new Error(`Missing generated path parameter: ${name}`);
        }
        pathname = pathname.replace(`{${name}}`, encodeURIComponent(parameterValue(value, `Path parameter ${name}`)));
      }
      if (pathname.includes('{')) {
        throw new Error(`Generated path still contains an unresolved parameter: ${pathname}`);
      }

      const query = new URLSearchParams();
      for (const name of descriptor.queryParameters) {
        const value = args[name];
        if (value === undefined) {
          continue;
        }
        for (const item of queryValue(value, name)) {
          query.append(name, item);
        }
      }

      const headers = new Headers();
      const body =
        descriptor.bodyParameters.length === 0
          ? undefined
          : Object.fromEntries(
              descriptor.bodyParameters.filter(name => args[name] !== undefined).map(name => [name, args[name]]),
            );
      if (body !== undefined) {
        headers.set('content-type', 'application/json');
      }

      const queryString = query.toString();
      const response = await client.fetch(
        resolveWireUrl(baseUrl, queryString.length === 0 ? pathname : `${pathname}?${queryString}`),
        {
          method: descriptor.method,
          headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        },
        { maxRetries: 0, ...(signal === undefined ? {} : { abortSignal: signal }) },
      );
      const parsed = responseBody(await response.text());
      if (!response.ok) {
        throw new WireApiError(response.status, parsed);
      }
      return parsed;
    },
  };
}
