/**
 * Global fetch interceptor + subscribable store for API errors.
 *
 * Both catalog.ts and the truefoundry-gateway-sdk clients resolve the global
 * `fetch` at request time, so patching it once at startup captures every API
 * failure (HTTP >= 400 and network errors) along with the response body.
 */

export interface ApiErrorRecord {
  id: number;
  timestamp: number;
  method: string;
  url: string;
  /** Absent for network-level failures that produced no response. */
  status?: number;
  statusText?: string;
  /** Error response body (or error message for network failures). */
  body: string;
}

const MAX_ERRORS = 50;
const MAX_BODY_CHARS = 10_000;

let nextId = 1;
let errors: readonly ApiErrorRecord[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function push(record: Omit<ApiErrorRecord, 'id' | 'timestamp'>): void {
  errors = [...errors.slice(-(MAX_ERRORS - 1)), { ...record, id: nextId++, timestamp: Date.now() }];
  emit();
}

export function subscribeApiErrors(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getApiErrorsSnapshot(): readonly ApiErrorRecord[] {
  return errors;
}

export function dismissApiError(id: number): void {
  errors = errors.filter(error => error.id !== id);
  emit();
}

export function clearApiErrors(): void {
  if (errors.length === 0) return;
  errors = [];
  emit();
}

function requestMethod(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method.toUpperCase();
  if (input instanceof Request) return input.method.toUpperCase();
  return 'GET';
}

function requestUrl(input: RequestInfo | URL): string {
  if (input instanceof Request) return input.url;
  return input instanceof URL ? input.href : input;
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const text = await response.clone().text();
    return text.length > MAX_BODY_CHARS ? `${text.slice(0, MAX_BODY_CHARS)}… (truncated)` : text;
  } catch {
    return '(response body could not be read)';
  }
}

let installed = false;

/** Patch the global fetch once; must run before any API client is created. */
export function installApiErrorInterceptor(): void {
  if (installed) return;
  installed = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const method = requestMethod(input, init);
    const url = requestUrl(input);
    let response: Response;
    try {
      response = await originalFetch(input, init);
    } catch (error) {
      push({
        method,
        url,
        body: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    if (response.status >= 400) {
      push({
        method,
        url,
        status: response.status,
        statusText: response.statusText,
        body: await readErrorBody(response),
      });
    }
    return response;
  };
}
