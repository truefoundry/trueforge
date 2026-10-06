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
 * Walk `Error.cause` (and plain `{ cause }` objects) outermost first, so undici-style
 * `TypeError: fetch failed` surfaces the nested `ECONNREFUSED` / cert reason. Cycle-safe.
 */
export function errorChain(error: unknown): unknown[] {
  const chain: unknown[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && current !== null && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = typeof current === 'object' && 'cause' in current ? Reflect.get(current, 'cause') : undefined;
  }
  return chain;
}

/** Joins the chain's messages, dropping links whose text the outer link already contains. */
function describeErrorChain(error: unknown): string {
  const messages = errorChain(error).map(link => messageOfUnknown(link).trim());
  let joined = '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const head = messages[i];
    if (head === undefined || head.length === 0) {
      continue;
    }
    joined = joined.length === 0 || head.includes(joined) ? head : `${head}: ${joined}`;
  }
  return joined;
}

/**
 * User/turn-facing message for any thrown value. Prefer Error.message / `.message`;
 * never surface developer-only strings (e.g. unserialisable dumps) in Agent Steps.
 * Includes nested `cause` messages when present (e.g. undici "fetch failed").
 */
export function describeUnknownError(error: unknown): string {
  const chain = describeErrorChain(error);
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
    const chain = describeErrorChain(error);
    return {
      error: chain.length > 0 ? chain : formatObjectErrorForLog(error),
      stack: error.stack,
    };
  }
  if (typeof error !== 'object' || error === null) {
    return { error: String(error) };
  }
  const chain = describeErrorChain(error);
  if (chain.length > 0) {
    return { error: chain };
  }
  return { error: formatObjectErrorForLog(error) };
}
