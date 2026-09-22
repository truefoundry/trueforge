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

export function extractErrorLogFields(error: unknown): ErrorLogFields {
  if (error instanceof Error) {
    const chain = describeErrorChain(error, new Set());
    return {
      error: chain.length > 0 ? chain : formatObjectErrorForLog(error),
      stack: error.stack,
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
