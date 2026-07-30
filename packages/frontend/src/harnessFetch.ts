/**
 * The gateway SDK targets /v1/agents with draft sessions as a separate resource; the harness serves one
 * /api/v1/sessions surface. Handed to the SDK clients as their `fetch`, this is the only place that knows.
 */

const SESSION_PATH = /^(https?:\/\/[^/]+)?\/v1\/agents\/(?:draft-)?sessions(?=$|[/?])/;

export function toHarnessUrl(url: string): string {
  return url.replace(SESSION_PATH, '$1/api/v1/sessions');
}

export const harnessFetch: typeof fetch = (input, init) => {
  if (typeof input === 'string' || input instanceof URL) return globalThis.fetch(toHarnessUrl(String(input)), init);
  const url = toHarnessUrl(input.url);
  // Rebuilding a Request that carries a body requires `duplex`, so only do it when the path changed.
  return url === input.url ? globalThis.fetch(input, init) : globalThis.fetch(new Request(url, input), init);
};
