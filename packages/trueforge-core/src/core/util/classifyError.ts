import { AgentHarnessError, ClassifiedHarnessError } from '../errors';
import { describeUnknownError, errorChain } from './errorLogFields';
import {
  CODE_KEEPS_UPSTREAM_TEXT,
  CODE_RETRYABLE,
  ERROR_COPY,
  type ErrorClassification,
  type ErrorCode,
  type ErrorSource,
  UNKNOWN_COPY,
} from './errorTaxonomy';

/**
 * Machine-readable facts gathered from the whole cause chain. Preferred over matching message
 * text, which upstream libraries reword without notice.
 */
interface ErrorSignals {
  /** String `.code` values: Node (`ECONNRESET`) and undici (`UND_ERR_BODY_TIMEOUT`). */
  stringCodes: string[];
  /** Numeric `.code` values: JSON-RPC, as used by MCP (`-32603`). */
  numericCodes: number[];
  /** `.statusCode` / `.status` values: AI SDK `APICallError`, our `McpConnectionError`. */
  statusCodes: number[];
  /** Constructor / `.name` values, e.g. `TimeoutError`, `AbortError`. */
  names: string[];
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function collectSignals(error: unknown): ErrorSignals {
  const signals: ErrorSignals = { stringCodes: [], numericCodes: [], statusCodes: [], names: [] };
  for (const link of errorChain(error)) {
    if (typeof link !== 'object' || link === null) {
      continue;
    }
    const code: unknown = Reflect.get(link, 'code');
    if (typeof code === 'string' && code.length > 0) {
      signals.stringCodes.push(code.toUpperCase());
    }
    const numericCode = readNumber(code);
    if (numericCode !== undefined) {
      signals.numericCodes.push(numericCode);
    }
    const statusCode = readNumber(Reflect.get(link, 'statusCode')) ?? readNumber(Reflect.get(link, 'status'));
    if (statusCode !== undefined) {
      signals.statusCodes.push(statusCode);
    }
    const name: unknown = Reflect.get(link, 'name');
    if (typeof name === 'string' && name.length > 0) {
      signals.names.push(name);
    }
  }
  return signals;
}

const TIMEOUT_STRING_CODES = ['UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT', 'ECONNABORTED'];
const TRANSPORT_STRING_CODES = ['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET', 'ENOTFOUND', 'EAI_AGAIN'];
const TIMEOUT_NAMES = ['TimeoutError', 'HeadersTimeoutError', 'BodyTimeoutError'];

/** Our own prefixes and provider wrappers, stripped so a title never stacks them. */
const UPSTREAM_PREFIXES = [
  /^request failed \(\d+\):\s*/i,
  /^error reading llm stream:\s*/i,
  /^failed to process successful response:\s*/i,
  /^call_tool failed:\s*/i,
  /^list_tools failed:\s*/i,
  /^tool call failed:\s*/i,
  /^sandbox execution error:\s*/i,
  /^(?:openai|anthropic|aws-bedrock|bedrock|google|vertex|azure|self-hosted|cohere|mistral)\s+error:\s*/i,
  /^mcp error -?\d+:\s*/i,
];

function stripUpstreamPrefixes(text: string): string {
  let stripped = text.trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of UPSTREAM_PREFIXES) {
      const next = stripped.replace(prefix, '');
      if (next !== stripped) {
        stripped = next.trim();
        changed = true;
      }
    }
  }
  return stripped;
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some(needle => haystack.includes(needle));
}

/**
 * Abort reasons raised by our own cancellation paths (`AbortSignal.abort(reason)` rejects with
 * the reason itself, so these arrive as bare strings rather than Errors).
 */
const CANCELLATION_REASONS = ['abandoned', 'client-cancelled', 'cancelled-for-next-turn', 'server-execution-timeout'];

/** Layer 1: structured fields. Nothing here depends on upstream wording. */
function codeFromSignals({ signals, source }: { signals: ErrorSignals; source: ErrorSource }): ErrorCode | undefined {
  // An abort inside the harness is a deliberate stop; against a remote it is a dropped transport.
  if (signals.names.includes('AbortError')) {
    return source === 'internal' ? 'turn_cancelled' : source === 'mcp' ? 'mcp_transport_lost' : transportCode(source);
  }
  if (
    signals.stringCodes.some(code => TIMEOUT_STRING_CODES.includes(code)) ||
    signals.names.some(name => TIMEOUT_NAMES.includes(name))
  ) {
    return source === 'mcp' ? 'mcp_connect_failed' : source === 'sandbox' ? 'sandbox_timeout' : timeoutCode(source);
  }
  if (signals.stringCodes.some(code => TRANSPORT_STRING_CODES.includes(code))) {
    return source === 'mcp' ? 'mcp_transport_lost' : transportCode(source);
  }
  // MCP JSON-RPC: -32601 unknown method, -32602 bad params, -32603 server-side failure.
  if (signals.numericCodes.includes(-32602)) {
    return 'mcp_tool_schema_mismatch';
  }
  if (signals.numericCodes.includes(-32603) || signals.numericCodes.includes(-32601)) {
    return 'mcp_tool_failed';
  }
  const status = signals.statusCodes[0];
  if (status !== undefined && source === 'model') {
    return modelCodeFromStatus(status);
  }
  return undefined;
}

function timeoutCode(source: ErrorSource): ErrorCode {
  switch (source) {
    case 'control_plane':
      return 'control_plane_timeout';
    case 'model':
      return 'model_timeout';
    default:
      return 'internal_error';
  }
}

function transportCode(source: ErrorSource): ErrorCode {
  switch (source) {
    case 'control_plane':
      return 'control_plane_unavailable';
    case 'model':
      return 'model_stream_interrupted';
    case 'sandbox':
      return 'sandbox_unavailable';
    default:
      return 'internal_error';
  }
}

function modelCodeFromStatus(status: number): ErrorCode | undefined {
  if (status === 401 || status === 403) {
    return 'model_auth_failed';
  }
  if (status === 429) {
    return 'model_rate_limited';
  }
  if (status === 408 || status === 504) {
    return 'model_timeout';
  }
  if (status >= 500) {
    return 'model_unavailable';
  }
  if (status >= 400) {
    return 'model_invalid_request';
  }
  return undefined;
}

/**
 * Layer 3: message text. Only for failures whose meaning exists nowhere but a provider's prose,
 * so a reworded upstream string degrades to the honest fallback rather than a wrong code.
 */
function codeFromText({ detail, source }: { detail: string; source: ErrorSource }): ErrorCode | undefined {
  const text = detail.toLowerCase();

  if (CANCELLATION_REASONS.includes(text.trim())) {
    return 'turn_cancelled';
  }
  if (includesAny(text, ['guardrail checks failed', 'guardrail blocked'])) {
    return source === 'mcp' ? 'mcp_guardrail_blocked' : 'model_guardrail_blocked';
  }
  if (text.includes('is not allowed on mcp server')) {
    return 'mcp_tool_not_allowed';
  }
  if (text.includes('failed to connect to remote mcp server') || text.includes('maximum reconnection attempts')) {
    return 'mcp_connect_failed';
  }
  // `Request failed (NNN)` is our own rendering of a provider status (describeStreamError). Once
  // the error has been flattened to a plain message the status is only recoverable from the text.
  const renderedStatus = /^request failed \((\d{3})\)/i.exec(detail.trim());
  if (renderedStatus?.[1] !== undefined && source === 'model') {
    const fromStatus = modelCodeFromStatus(Number.parseInt(renderedStatus[1], 10));
    if (fromStatus !== undefined) {
      return fromStatus;
    }
  }
  if (includesAny(text, ['headers timeout error', 'body timeout error', 'timed out after', 'operation was aborted'])) {
    return source === 'mcp' ? 'mcp_connect_failed' : timeoutCode(source);
  }
  if (
    includesAny(text, [
      'terminated',
      'other side closed',
      'sse stream disconnected',
      'failed to reconnect sse stream',
      'failed to open sse stream',
      'response stream ended without a finish reason',
      'unexpected end of json input',
      'fetch failed',
    ])
  ) {
    return source === 'mcp' ? 'mcp_transport_lost' : transportCode(source);
  }
  if (text.includes('command execution timeout')) {
    return 'sandbox_timeout';
  }
  if (text.includes('state change in progress')) {
    return 'sandbox_busy';
  }
  if (includesAny(text, ['sandbox is unavailable', 'no longer exists'])) {
    return 'sandbox_unavailable';
  }
  return undefined;
}

/**
 * Copy for a failure no rule recognised. Harness errors already carry a message written for
 * whoever has to fix them (a bad capability key, a tool-name collision), so that wins over the
 * generic per-source sentence.
 */
function unknownTitle({ error, source }: { error: unknown; source: ErrorSource }): string {
  for (const link of errorChain(error)) {
    if (link instanceof AgentHarnessError && link.message !== '') {
      return link.message;
    }
  }
  return UNKNOWN_COPY[source];
}

/**
 * The classification attached at the failure's source, if any. Callers that already have good
 * hand-written copy (HTTP routes) use this instead of `classifyError` so an unrecognised error
 * is reported without a guessed code.
 */
export function attachedClassification(error: unknown): ErrorClassification | undefined {
  for (const link of errorChain(error)) {
    if (link instanceof ClassifiedHarnessError) {
      return link.classification;
    }
  }
  return undefined;
}

/**
 * Resolves any thrown value to one taxonomy entry. `source` comes from the boundary that caught
 * the error — it always knows which subsystem it is — so an unrecognised failure still reports
 * the right layer instead of guessing a code.
 */
export function classifyError({ error, source }: { error: unknown; source: ErrorSource }): ErrorClassification {
  const attached = attachedClassification(error);
  if (attached !== undefined) {
    return attached;
  }
  const detail = describeUnknownError(error);
  const signals = collectSignals(error);
  const code = codeFromSignals({ signals, source }) ?? codeFromText({ detail, source }) ?? 'internal_error';

  const upstream = stripUpstreamPrefixes(detail);
  const base = code === 'internal_error' ? unknownTitle({ error, source }) : ERROR_COPY[code];
  const title =
    CODE_KEEPS_UPSTREAM_TEXT.has(code) && upstream.length > 0 && upstream.length <= 300 ? `${base} ${upstream}` : base;

  return { code, source, retryable: CODE_RETRYABLE[code], title, detail };
}

/** Structured log fields so failures can be counted by code without parsing message text. */
export function classificationLogFields(classification: ErrorClassification): {
  error_code: ErrorCode;
  error_source: ErrorSource;
  retryable: boolean;
} {
  return {
    error_code: classification.code,
    error_source: classification.source,
    retryable: classification.retryable,
  };
}
