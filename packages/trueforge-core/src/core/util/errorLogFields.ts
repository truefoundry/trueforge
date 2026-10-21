export interface ErrorLogFields {
  error: string;
  stack?: string | undefined;
}

function formatObjectErrorForLog(error: object): string {
  try {
    return JSON.stringify(error);
  } catch {
    return `unserialisable error (${Object.keys(error).join(', ')})`;
  }
}

/** Single-hop message for any thrown value (no cause walk). */
function messageOfUnknown(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error !== 'object' || error === null) {
    return String(error);
  }
  const message: unknown = Reflect.get(error, 'message');
  if (typeof message === 'string' && message.length > 0) {
    return message;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return '';
  }
}

/**
 * Walk `Error.cause` (and plain `{ cause }` objects) so undici-style
 * `TypeError: fetch failed` surfaces the nested `ECONNREFUSED` / cert reason.
 */
function describeErrorChain(error: unknown, seen: Set<unknown>): string {
  if (error === undefined || error === null || seen.has(error)) {
    return '';
  }
  seen.add(error);

  const head = messageOfUnknown(error).trim();
  const nestedCause = typeof error === 'object' && 'cause' in error ? Reflect.get(error, 'cause') : undefined;
  const tail = describeErrorChain(nestedCause, seen).trim();

  if (head.length === 0) {
    return tail;
  }
  if (tail.length === 0 || head.includes(tail)) {
    return head;
  }
  return `${head}: ${tail}`;
}

/**
 * User/turn-facing message for any thrown value. Prefer Error.message / `.message`;
 * never surface developer-only strings (e.g. unserialisable dumps) in Agent Steps.
 * Includes nested `cause` messages when present (e.g. undici "fetch failed").
 */
export function describeUnknownError(error: unknown): string {
  const chain = describeErrorChain(error, new Set());
  if (chain.length > 0) {
    return chain;
  }
  if (typeof error === 'object' && error !== null) {
    return 'An unexpected error occurred';
  }
  return String(error);
}

/**
 * `error.stack` stops at the wrapper. Each `cause` stack is the throw beneath it,
 * so the log keeps the whole chain.
 */
function stackWithCauses(error: Error): string | undefined {
  const stacks: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (typeof current === 'object' && current !== null && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error && current.stack !== undefined) {
      stacks.push(current.stack);
    }
    if (!('cause' in current)) {
      break;
    }
    current = Reflect.get(current, 'cause');
  }
  return stacks.length > 0 ? stacks.join('\nCaused by: ') : undefined;
}

const REPORTABLE_TRANSPORT_ERROR_NAMES = new Set([
  'AbortError',
  'TimeoutError',
  'ConnectTimeoutError',
  'HeadersTimeoutError',
  'BodyTimeoutError',
]);

const REPORTABLE_TRANSPORT_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ECONNABORTED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET',
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'ERR_TLS_CERT_ALTNAME_INVALID',
]);

function transportErrorCode(error: object): string | undefined {
  if (!('code' in error)) {
    return undefined;
  }
  const code: unknown = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : undefined;
}

function hasReportableTransportSignal(error: unknown, seen: Set<unknown>): boolean {
  if (typeof error !== 'object' || error === null || seen.has(error)) {
    return false;
  }
  seen.add(error);
  if (error instanceof Error && REPORTABLE_TRANSPORT_ERROR_NAMES.has(error.name)) {
    return true;
  }
  const code = transportErrorCode(error);
  if (code !== undefined && REPORTABLE_TRANSPORT_ERROR_CODES.has(code)) {
    return true;
  }
  if (!('cause' in error)) {
    return false;
  }
  return hasReportableTransportSignal(Reflect.get(error, 'cause'), seen);
}

/** Timeout, DNS, TLS, and socket failures, including those nested on `error.cause`. */
export function isReportableTransportFailure(error: unknown): boolean {
  return hasReportableTransportSignal(error, new Set());
}

export function extractErrorLogFields(error: unknown): ErrorLogFields {
  if (error instanceof Error) {
    const chain = describeErrorChain(error, new Set());
    return {
      error: chain.length > 0 ? chain : formatObjectErrorForLog(error),
      stack: stackWithCauses(error),
    };
  }
  if (typeof error !== 'object' || error === null) {
    return { error: String(error) };
  }
  const chain = describeErrorChain(error, new Set());
  if (chain.length > 0) {
    return { error: chain };
  }
  return { error: formatObjectErrorForLog(error) };
}
