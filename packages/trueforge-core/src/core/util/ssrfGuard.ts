import type { LookupAllOptions, LookupOptions } from 'node:dns';
import { lookup as dnsLookup } from 'node:dns';
import { lookup as dnsLookupAsync } from 'node:dns/promises';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';
import {
  elapsedSeconds,
  getOperationMetrics,
  httpStatusClass,
  type OutboundHttpModule,
  type OutboundHttpOutcome,
  type OutboundHttpRetryReason,
  type OutboundHttpRetryStatus,
} from '../observability/operationMetrics';

let allowedHosts: string[] = [];
let blockedHosts: string[] = [];
let guardEnabled = true;

/** Prefix of every SSRF rejection, including the host, protocol, and redirect messages. */
export const OUTBOUND_URL_BLOCKED = 'Outbound URL blocked';

/** Thrown when the guard rejects a URL. undici may wrap one lookup failure as `cause`. */
export class OutboundUrlBlockedError extends Error {
  constructor(message: string, options?: { cause: unknown }) {
    super(message, options);
    this.name = 'OutboundUrlBlockedError';
  }
}

const UND_ERR_CONNECT_TIMEOUT = 'UND_ERR_CONNECT_TIMEOUT';
const UND_ERR_HEADERS_TIMEOUT = 'UND_ERR_HEADERS_TIMEOUT';
const UND_ERR_BODY_TIMEOUT = 'UND_ERR_BODY_TIMEOUT';
const OUTBOUND_TIMEOUT_CODES = new Set([UND_ERR_CONNECT_TIMEOUT, UND_ERR_HEADERS_TIMEOUT, UND_ERR_BODY_TIMEOUT]);

const MAX_REDIRECTS = 20;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const CROSS_ORIGIN_STRIPPED_HEADERS = ['authorization', 'proxy-authorization', 'cookie', 'host'];
// Rejected before processing (timeout, rate limit, gateway never reached the origin).
const UNPROCESSED_RETRY_STATUSES = new Set([408, 429, 503, 521, 522, 523, 530]);
// Upstream may have processed the request (502 invalid origin response, 409 conflict, 520 bad origin response, 524 origin timeout).
const MAYBE_PROCESSED_RETRY_STATUSES = new Set([409, 502, 520, 524]);
const RETRY_INITIAL_DELAY_MS = 1_000;
const RETRY_BACKOFF_FACTOR = 2;
const RETRY_JITTER_FACTOR = 0.2;
// Longer server-requested waits fall back to backoff rather than stalling the caller.
const MAX_RETRY_AFTER_MS = 5_000;

export interface OutboundFetchOptions {
  connectTimeoutMs: number;
  headersTimeoutMs: number;
  bodyTimeoutMs: number;
  maxRetries: number;
  /**
   * Whether requests are safe to replay after upstream may have received them. When false, headers
   * timeouts and 409/520/524 are not retried.
   */
  idempotent: boolean;
  /** When set, each fetch records one observation on the process recorder. Absent skips metrics. */
  metrics?: {
    module: OutboundHttpModule;
  };
}

export interface OutboundFetch {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  close: () => Promise<void>;
}

const URL_VERIFY = {
  allowedProtocols: ['http:', 'https:'],
  denyCidrsV4: [
    '0.0.0.0/8', // this host
    '10.0.0.0/8', // private
    '100.64.0.0/10', // CGNAT (EKS secondary pod CIDRs)
    '127.0.0.0/8', // loopback
    '169.254.0.0/16', // link-local + metadata
    '172.16.0.0/12', // private (docker, k8s service CIDRs)
    '192.0.0.0/24', // IETF protocol assignments
    '192.0.2.0/24', // TEST-NET-1
    '192.88.99.0/24', // 6to4 relay anycast
    '192.168.0.0/16', // private
    '198.18.0.0/15', // benchmarking
    '198.51.100.0/24', // TEST-NET-2
    '203.0.113.0/24', // TEST-NET-3
    '224.0.0.0/4', // multicast
    '240.0.0.0/4', // reserved + broadcast
  ],
  denyCidrsV6: [
    '::/96', // unspecified, ::1, IPv4-compatible
    '64:ff9b::/96', // NAT64 well-known
    '64:ff9b:1::/48', // NAT64 local-use
    '100::/64', // discard-only
    '2001::/32', // Teredo
    '2001:10::/28', // ORCHID
    '2001:20::/28', // ORCHIDv2
    '2001:db8::/32', // documentation
    '2002::/16', // 6to4
    'fc00::/7', // unique-local (IPv6 k8s service CIDRs)
    'fe80::/10', // link-local
    'ff00::/8', // multicast
  ],
  denyHostSuffixes: [
    '.local',
    '.localhost',
    '.localdomain',
    '.internal',
    '.svc',
    '.cluster',
    '.arpa',
    '.lan',
    '.intranet',
    '.corp',
    '.home',
    '.test',
    '.invalid',
    '.example',
  ],
};

const privateNets = new BlockList();
function addDenyCidrs(cidrs: readonly string[], family: 'ipv4' | 'ipv6'): void {
  for (const cidr of cidrs) {
    const slash = cidr.lastIndexOf('/');
    privateNets.addSubnet(cidr.slice(0, slash), Number(cidr.slice(slash + 1)), family);
  }
}
addDenyCidrs(URL_VERIFY.denyCidrsV4, 'ipv4');
addDenyCidrs(URL_VERIFY.denyCidrsV6, 'ipv6');

function normalizeHost(hostname: string): string {
  const host = hostname.replace(/\.$/, '').toLowerCase();
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

function isPrivateIp(address: string): boolean {
  const ip = address.replace(/^::ffff:/i, '');
  if (isIP(ip) === 4) {
    return privateNets.check(ip, 'ipv4');
  }
  if (isIP(ip) === 6) {
    return privateNets.check(ip, 'ipv6');
  }
  return true;
}

function blockedError(host: string, cause?: unknown): OutboundUrlBlockedError {
  const message = `${OUTBOUND_URL_BLOCKED} for host "${host}"`;
  return cause === undefined ? new OutboundUrlBlockedError(message) : new OutboundUrlBlockedError(message, { cause });
}

function deny(host: string, cause?: unknown): never {
  throw blockedError(host, cause);
}

function assertHost(host: string): void {
  if (host === '' || blockedHosts.includes(host)) {
    deny(host);
  }
  if (allowedHosts.includes(host)) {
    return;
  }
  if (isIP(host) === 0) {
    if (!host.includes('.') || URL_VERIFY.denyHostSuffixes.some(suffix => host.endsWith(suffix))) {
      deny(host);
    }
    return;
  }
  if (isPrivateIp(host)) {
    deny(host);
  }
}

function parseOutboundUrl(input: string | URL | Request): URL {
  let url: URL;
  try {
    url = new URL(input instanceof Request ? input.url : input);
  } catch (error) {
    throw new OutboundUrlBlockedError(OUTBOUND_URL_BLOCKED, { cause: error });
  }
  if (!URL_VERIFY.allowedProtocols.includes(url.protocol)) {
    throw new OutboundUrlBlockedError(`${OUTBOUND_URL_BLOCKED}: only http and https are allowed`);
  }
  return url;
}

/** undici runs this as the socket lookup, so the addresses we allow are the ones connected to. */
const guardedLookup: LookupFunction = (hostname, options: LookupOptions, callback) => {
  if (!guardEnabled) {
    dnsLookup(hostname, options, callback);
    return;
  }
  const host = normalizeHost(hostname);
  try {
    assertHost(host);
  } catch (error) {
    callback(error instanceof Error ? error : blockedError(host, error), '');
    return;
  }
  if (allowedHosts.includes(host) || isIP(host) !== 0) {
    dnsLookup(hostname, options, callback);
    return;
  }
  const allOptions: LookupAllOptions = { ...options, all: true };
  dnsLookup(hostname, allOptions, (err, addresses) => {
    if (err) {
      callback(err, '');
      return;
    }
    const first = addresses[0];
    if (first === undefined || addresses.some(record => isPrivateIp(record.address))) {
      callback(blockedError(host), '');
      return;
    }
    if (options.all) {
      callback(null, addresses);
      return;
    }
    callback(null, first.address, first.family);
  });
};

/** SSRF allow/block policy for all outbound guarded fetches. Timeouts live on `createOutboundFetch`. */
export function configureOutboundUrlGuard(config: {
  enabled?: boolean;
  allowedHosts: readonly string[];
  blockedHosts: readonly string[];
}): void {
  guardEnabled = config.enabled ?? true;
  allowedHosts = config.allowedHosts.map(normalizeHost);
  blockedHosts = config.blockedHosts.map(normalizeHost);
}

export async function assertSafeOutboundUrl(input: string | URL | Request): Promise<void> {
  const url = parseOutboundUrl(input);
  if (!guardEnabled) {
    return;
  }
  const host = normalizeHost(url.hostname);
  assertHost(host);
  if (allowedHosts.includes(host) || isIP(host) !== 0) {
    return;
  }
  let addresses: string[];
  try {
    addresses = (await dnsLookupAsync(host, { all: true })).map(record => record.address);
  } catch (error) {
    deny(host, error);
  }
  if (addresses.some(isPrivateIp)) {
    deny(host);
  }
}

function nextHop(
  response: Response,
  location: string,
  current: URL,
  init: RequestInit,
): { url: URL; init: RequestInit } {
  let nextUrl: URL;
  try {
    nextUrl = new URL(location, current);
  } catch (error) {
    throw new OutboundUrlBlockedError(OUTBOUND_URL_BLOCKED, { cause: error });
  }
  if (!URL_VERIFY.allowedProtocols.includes(nextUrl.protocol)) {
    throw new OutboundUrlBlockedError(`${OUTBOUND_URL_BLOCKED}: only http and https are allowed`);
  }
  // Cleartext after TLS would drop confidentiality of the hop; block downgrades.
  if (current.protocol === 'https:' && nextUrl.protocol === 'http:') {
    throw new OutboundUrlBlockedError(`${OUTBOUND_URL_BLOCKED}: https to http redirect is not allowed`);
  }

  const headers = new Headers(init.headers);
  let method = (init.method ?? 'GET').toUpperCase();
  let body = init.body ?? null;
  const downgradesToGet =
    ((response.status === 301 || response.status === 302) && method === 'POST') ||
    (response.status === 303 && method !== 'GET' && method !== 'HEAD');
  if (downgradesToGet) {
    method = 'GET';
    body = null;
    headers.delete('content-encoding');
    headers.delete('content-language');
    headers.delete('content-location');
    headers.delete('content-type');
    headers.delete('content-length');
  }
  if (nextUrl.origin !== current.origin) {
    for (const header of CROSS_ORIGIN_STRIPPED_HEADERS) {
      headers.delete(header);
    }
  }
  return { url: nextUrl, init: { ...init, method, headers, body } };
}

function mergeRequestInit(input: string | URL | Request, init: RequestInit): RequestInit {
  if (!(input instanceof Request)) {
    return init;
  }
  return {
    method: input.method,
    headers: input.headers,
    body: input.body,
    signal: input.signal,
    redirect: input.redirect,
    ...init,
  };
}

/** Bodies that undici can send more than once without re-reading a stream. */
function isReplayableBodyInit(body: NonNullable<RequestInit['body']>): boolean {
  return (
    typeof body === 'string' ||
    body instanceof ArrayBuffer ||
    ArrayBuffer.isView(body) ||
    body instanceof Blob ||
    body instanceof FormData ||
    body instanceof URLSearchParams
  );
}

/**
 * Normalize to URL + init, buffering one-shot stream bodies so retries can replay them.
 * `Request` bodies are always streams even when constructed from a string.
 */
async function materializeReplayableOutboundRequest(
  input: string | URL | Request,
  init: RequestInit,
): Promise<{ input: URL; init: RequestInit }> {
  const url = parseOutboundUrl(input);
  const merged = mergeRequestInit(input, init);
  const body = merged.body;
  if (body == null || isReplayableBodyInit(body)) {
    return { input: url, init: merged };
  }
  const buffer = await new Response(body).arrayBuffer();
  return {
    input: url,
    init: {
      ...merged,
      body: buffer,
    },
  };
}

function getErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current != null; depth += 1) {
    if (typeof current === 'object' && 'code' in current) {
      const code = Reflect.get(current, 'code');
      if (typeof code === 'string') {
        return code;
      }
    }
    current = current instanceof Error ? current.cause : undefined;
  }
  return undefined;
}

/** Connect / headers-read timeouts from undici (including nested under TypeError: fetch failed). */
export function isRetryableOutboundTransportError(error: unknown, options: { idempotent: boolean }): boolean {
  return transportRetryReason(error, options.idempotent) !== undefined;
}

/** Connect timeouts always retry. Headers timeouts retry only when the call is safe to replay. */
function transportRetryReason(error: unknown, idempotent: boolean): 'connect_timeout' | 'headers_timeout' | undefined {
  const code = getErrorCode(error);
  if (code === UND_ERR_CONNECT_TIMEOUT) {
    return 'connect_timeout';
  }
  if (idempotent && code === UND_ERR_HEADERS_TIMEOUT) {
    return 'headers_timeout';
  }
  return undefined;
}

function isRetryableOutboundStatus(
  status: number,
  options: { idempotent: boolean },
): status is OutboundHttpRetryStatus {
  return UNPROCESSED_RETRY_STATUSES.has(status) || (options.idempotent && MAYBE_PROCESSED_RETRY_STATUSES.has(status));
}

/** Server-requested delay from `retry-after-ms` or `retry-after` (seconds or HTTP date), if usable. */
function retryAfterMs(headers: { get(name: string): string | null }): number | undefined {
  let delayMs: number | undefined;
  const retryAfterMsHeader = headers.get('retry-after-ms');
  if (retryAfterMsHeader !== null) {
    delayMs = Number.parseFloat(retryAfterMsHeader);
  } else {
    const retryAfter = headers.get('retry-after');
    if (retryAfter !== null) {
      const seconds = Number(retryAfter);
      delayMs = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now();
    }
  }
  if (delayMs === undefined || !Number.isFinite(delayMs) || delayMs < 0 || delayMs > MAX_RETRY_AFTER_MS) {
    return undefined;
  }
  return delayMs;
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) {
    return signal.reason;
  }
  const aborted = new Error('This operation was aborted');
  aborted.name = 'AbortError';
  return aborted;
}

function retryDelayMs(attempt: number): number {
  const base = RETRY_INITIAL_DELAY_MS * RETRY_BACKOFF_FACTOR ** attempt;
  const jitterMultiplier = 1 + (Math.random() - 0.5) * RETRY_JITTER_FACTOR;
  return Math.max(0, Math.round(base * jitterMultiplier));
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError(signal));
      return;
    }
    const timer = setTimeout(() => {
      if (signal !== undefined) {
        signal.removeEventListener('abort', onAbort);
      }
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      if (signal !== undefined) {
        reject(abortError(signal));
        return;
      }
      reject(new Error('This operation was aborted'));
    };
    if (signal !== undefined) {
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function guardedFetch(
  input: string | URL | Request,
  init: RequestInit,
  hopsLeft: number,
  agent: Agent,
): Promise<Response> {
  const url = parseOutboundUrl(input);
  if (guardEnabled) {
    assertHost(normalizeHost(url.hostname));
  }
  const merged = mergeRequestInit(input, init);
  const redirect = merged.redirect ?? 'follow';
  const followsRedirects = guardEnabled && redirect === 'follow';
  const requestInit = {
    redirect: followsRedirects ? 'manual' : redirect,
    dispatcher: agent,
  };
  // npm undici vs @types/node undici-types: FormData/Headers do not line up under exactOptionalPropertyTypes.
  Object.assign(requestInit, merged, {
    redirect: followsRedirects ? 'manual' : redirect,
    dispatcher: agent,
    ...(merged.body != null && typeof merged.body === 'object' && 'getReader' in merged.body
      ? { duplex: 'half' as const }
      : {}),
  });
  const response = await undiciFetch(url.href, requestInit);
  if (!followsRedirects) {
    return response;
  }
  if (!REDIRECT_STATUSES.has(response.status)) {
    return response;
  }
  const location = response.headers.get('location');
  if (location === null) {
    return response;
  }
  void response.body?.cancel().catch(() => undefined);
  if (hopsLeft === 0) {
    throw new OutboundUrlBlockedError(`${OUTBOUND_URL_BLOCKED}: too many redirects`);
  }
  const hop = nextHop(response, location, url, merged);
  return guardedFetch(hop.url, hop.init, hopsLeft - 1, agent);
}

async function withOutboundHttpRetries(
  input: string | URL | Request,
  init: RequestInit,
  agent: Agent,
  options: {
    maxRetries: number;
    idempotent: boolean;
    metrics?: OutboundFetchOptions['metrics'];
  },
): Promise<Response> {
  const signal = init.signal ?? (input instanceof Request ? input.signal : undefined);
  // Buffer stream / Request bodies once so a retry does not hit a consumed-body error.
  const replayable = options.maxRetries > 0 ? await materializeReplayableOutboundRequest(input, init) : { input, init };
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) {
      throw abortError(signal);
    }
    let delayMs = retryDelayMs(attempt);
    let retryReason: OutboundHttpRetryReason | undefined;
    try {
      const response = await guardedFetch(replayable.input, replayable.init, MAX_REDIRECTS, agent);
      if (!isRetryableOutboundStatus(response.status, options) || attempt >= options.maxRetries) {
        return response;
      }
      retryReason = response.status;
      delayMs = retryAfterMs(response.headers) ?? delayMs;
      void response.body?.cancel().catch(() => undefined);
    } catch (error) {
      const reason = transportRetryReason(error, options.idempotent);
      if (reason === undefined || attempt >= options.maxRetries || signal?.aborted) {
        throw error;
      }
      retryReason = reason;
    }
    await sleep(delayMs, signal);
    const metricsModule = options.metrics?.module;
    if (metricsModule !== undefined) {
      getOperationMetrics()?.recordOutboundHttpRetry({ module: metricsModule, reason: retryReason });
    }
    attempt += 1;
  }
}

/** Guard throws directly. undici wraps a blocked lookup once, under `TypeError: fetch failed`. */
function isBlockedOutboundError(error: unknown): boolean {
  return (
    error instanceof OutboundUrlBlockedError ||
    (error instanceof Error && error.cause instanceof OutboundUrlBlockedError)
  );
}

function failedOutboundHttpOutcome(error: unknown): Exclude<OutboundHttpOutcome, 'success'> {
  if (isBlockedOutboundError(error)) {
    return 'blocked';
  }
  const code = getErrorCode(error);
  if (code !== undefined && OUTBOUND_TIMEOUT_CODES.has(code)) {
    return 'timeout';
  }
  return 'error';
}

/** 2xx and 3xx completed the transport. 4xx and 5xx are errors. */
function responseOutboundHttpOutcome(status: number): OutboundHttpOutcome {
  return status >= 200 && status < 400 ? 'success' : 'error';
}

/** Builds a pooled undici Agent + SSRF-guarded fetch with the given timeouts/retries. */
export function createOutboundFetch(options: OutboundFetchOptions): OutboundFetch {
  const agent = new Agent({
    bodyTimeout: options.bodyTimeoutMs,
    headersTimeout: options.headersTimeoutMs,
    connectTimeout: options.connectTimeoutMs,
    connect: { lookup: guardedLookup, timeout: options.connectTimeoutMs },
  });
  const maxRetries = options.maxRetries;
  const idempotent = options.idempotent;
  const metricsModule = options.metrics?.module;
  return {
    fetch: async (input, init) => {
      const startedMs = performance.now();
      const metrics = metricsModule === undefined ? undefined : { module: metricsModule };
      try {
        const response = await withOutboundHttpRetries(input, init ?? {}, agent, { maxRetries, idempotent, metrics });
        if (metricsModule !== undefined) {
          getOperationMetrics()?.recordOutboundHttpRequest({
            module: metricsModule,
            outcome: responseOutboundHttpOutcome(response.status),
            statusClass: httpStatusClass(response.status),
            durationSeconds: elapsedSeconds(startedMs),
          });
        }
        return response;
      } catch (error) {
        if (metricsModule !== undefined) {
          getOperationMetrics()?.recordOutboundHttpRequest({
            module: metricsModule,
            outcome: failedOutboundHttpOutcome(error),
            statusClass: 'none',
            durationSeconds: elapsedSeconds(startedMs),
          });
        }
        throw error;
      }
    },
    close: async () => {
      await agent.close().catch(() => undefined);
    },
  };
}
