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

export interface CreateWireApiClientOptions {
  baseUrl: string;
  fetch: typeof fetch;
  /** Caller credential; when null/undefined, no Authorization header is sent. */
  token?: string | null;
  /** Request timeout in seconds. Defaults to 60. */
  timeoutInSeconds?: number;
}

/** Map generated tool arguments onto authenticated internal HTTP requests. */
export function createWireApiClient(options: CreateWireApiClientOptions): WireApiClient {
  const { baseUrl, fetch: fetchFn, token, timeoutInSeconds = 60 } = options;
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
      if (token != null && token !== '') {
        headers.set('authorization', `Bearer ${token}`);
      }
      const body =
        descriptor.bodyParameters.length === 0
          ? undefined
          : Object.fromEntries(
              descriptor.bodyParameters.filter(name => args[name] !== undefined).map(name => [name, args[name]]),
            );
      if (body !== undefined) {
        headers.set('content-type', 'application/json');
      }

      const url = new URL(pathname, baseUrl);
      url.search = query.toString();
      const timeoutSignal = AbortSignal.timeout(timeoutInSeconds * 1000);
      const requestSignal = signal === undefined ? timeoutSignal : AbortSignal.any([signal, timeoutSignal]);
      const response = await fetchFn(url, {
        method: descriptor.method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: requestSignal,
      });
      const parsed = responseBody(await response.text());
      if (!response.ok) {
        throw new WireApiError(response.status, parsed);
      }
      return parsed;
    },
  };
}
