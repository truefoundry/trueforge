import { ClassifiedHarnessError } from '../../../src/core/errors';
import { attachedClassification, classificationLogFields, classifyError } from '../../../src/core/util/classifyError';
import type { ErrorCode, ErrorSource } from '../../../src/core/util/errorTaxonomy';

/** Error carrying the `.code` undici and Node set, which classification prefers over message text. */
function errorWithCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

function errorWithStatus(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

describe('classifyError', () => {
  describe('structured signals win over message text', () => {
    it.each([
      ['UND_ERR_HEADERS_TIMEOUT', 'model', 'model_timeout'],
      ['UND_ERR_BODY_TIMEOUT', 'model', 'model_timeout'],
      ['ECONNRESET', 'model', 'model_stream_interrupted'],
      ['ECONNREFUSED', 'control_plane', 'control_plane_unavailable'],
      ['UND_ERR_HEADERS_TIMEOUT', 'mcp', 'mcp_connect_failed'],
      ['ECONNRESET', 'mcp', 'mcp_transport_lost'],
    ] satisfies [string, ErrorSource, ErrorCode][])('maps .code %s from %s to %s', (code, source, expected) => {
      // Deliberately unhelpful message: only the structured code should decide the outcome.
      expect(classifyError({ error: errorWithCode('fetch failed', code), source }).code).toBe(expected);
    });

    it.each([
      [401, 'model_auth_failed'],
      [403, 'model_auth_failed'],
      [429, 'model_rate_limited'],
      [400, 'model_invalid_request'],
      [500, 'model_unavailable'],
      [520, 'model_unavailable'],
      [504, 'model_timeout'],
    ] satisfies [number, ErrorCode][])('maps model status %s to %s', (status, expected) => {
      expect(classifyError({ error: errorWithStatus('upstream said no', status), source: 'model' }).code).toBe(
        expected,
      );
    });

    it.each([
      [-32602, 'mcp_tool_schema_mismatch'],
      [-32603, 'mcp_tool_failed'],
    ] satisfies [number, ErrorCode][])('maps JSON-RPC %s to %s', (rpcCode, expected) => {
      const error = Object.assign(new Error('MCP failure'), { code: rpcCode });
      expect(classifyError({ error, source: 'mcp' }).code).toBe(expected);
    });

    it('reads a code nested behind Error.cause', () => {
      const inner = errorWithCode('read ECONNRESET', 'ECONNRESET');
      const outer = new Error('fetch failed', { cause: inner });
      expect(classifyError({ error: outer, source: 'mcp' }).code).toBe('mcp_transport_lost');
    });
  });

  // Every string below was observed in production and reported in #trueforge on 2026-10-05.
  describe('production error strings', () => {
    it.each([
      ['Cannot connect to API: Headers Timeout Error', 'model', 'model_timeout', true],
      ['Response stream ended without a finish reason.', 'model', 'model_stream_interrupted', true],
      ['Unexpected end of JSON input', 'model', 'model_stream_interrupted', true],
      ['terminated: Body Timeout Error', 'model', 'model_timeout', true],
      ['Failed to process successful response: terminated: Body Timeout Error', 'model', 'model_timeout', true],
      [
        'Request failed (500): anthropic error: Message: fetch failed Cause: AggregateError Name: TypeError',
        'model',
        'model_unavailable',
        true,
      ],
      [
        "Request failed (400): openai error: Unsupported value: 'reasoning_effort' does not support 'none' with this model.",
        'model',
        'model_invalid_request',
        false,
      ],
      [
        'Request failed (400): Input Guardrail checks failed for integrations: [tam-agent-guardrails/tam-request-metadata]',
        'model',
        'model_guardrail_blocked',
        false,
      ],
      [
        'TrueFoundry ServiceFoundry server request timed out after 10s: The operation was aborted due to timeout',
        'control_plane',
        'control_plane_timeout',
        true,
      ],
      ['command execution timeout', 'sandbox', 'sandbox_timeout', true],
      ['Sandbox state change in progress', 'sandbox', 'sandbox_busy', true],
      ['Sandbox is unavailable; recovery attempt failed.', 'sandbox', 'sandbox_unavailable', false],
      ["Tool 'web_search' is not allowed on MCP server fleet-demo-http", 'mcp', 'mcp_tool_not_allowed', false],
      ['SSE error: TypeError: terminated: other side closed', 'mcp', 'mcp_transport_lost', true],
      ['Failed to reconnect SSE stream: fetch failed', 'mcp', 'mcp_transport_lost', true],
      ['Streamable HTTP error: Failed to open SSE stream: Not Found', 'mcp', 'mcp_transport_lost', true],
      ['Maximum reconnection attempts (2) exceeded.', 'mcp', 'mcp_connect_failed', true],
      [
        "Failed to connect to remote MCP server 'jira-confluence-oss': Timed out after 30000ms",
        'mcp',
        'mcp_connect_failed',
        true,
      ],
      [
        'Output Guardrail checks failed for integrations: [tam-agent-guardrails/tam-sql-sanitizer]',
        'mcp',
        'mcp_guardrail_blocked',
        false,
      ],
      ['abandoned', 'internal', 'turn_cancelled', true],
    ] satisfies [string, ErrorSource, ErrorCode, boolean][])(
      'classifies %s',
      (message, source, expectedCode, expectedRetryable) => {
        const classification = classifyError({ error: new Error(message), source });
        expect(classification.code).toBe(expectedCode);
        expect(classification.retryable).toBe(expectedRetryable);
        expect(classification.source).toBe(source);
      },
    );
  });

  describe('titles', () => {
    it('keeps the provider sentence when it is the actionable part', () => {
      const classification = classifyError({
        error: new Error(
          "Request failed (400): openai error: Unsupported value: 'reasoning_effort' does not support 'none' with this model.",
        ),
        source: 'model',
      });
      expect(classification.title).toBe(
        "The model rejected the request. Unsupported value: 'reasoning_effort' does not support 'none' with this model.",
      );
    });

    it('drops transport jargon when it tells the user nothing', () => {
      const classification = classifyError({ error: new Error('terminated: Body Timeout Error'), source: 'model' });
      expect(classification.title).toBe('The model provider did not respond in time.');
      expect(classification.detail).toBe('terminated: Body Timeout Error');
    });
  });

  describe('unknown failures', () => {
    it('falls back to internal_error and is never retryable', () => {
      const classification = classifyError({ error: new Error('some brand new upstream wording'), source: 'model' });
      expect(classification.code).toBe('internal_error');
      expect(classification.retryable).toBe(false);
    });

    it('still names the subsystem that failed', () => {
      expect(classifyError({ error: new Error('mystery'), source: 'mcp' }).title).toBe(
        'The MCP server request failed.',
      );
      expect(classifyError({ error: new Error('mystery'), source: 'sandbox' }).title).toBe(
        'The sandbox request failed.',
      );
    });

    it('keeps the raw text as detail so nothing is lost', () => {
      expect(classifyError({ error: new Error('mystery wording'), source: 'model' }).detail).toBe('mystery wording');
    });
  });

  describe('attached classifications', () => {
    it('is reused instead of re-derived', () => {
      const original = classifyError({ error: new Error('command execution timeout'), source: 'sandbox' });
      const wrapped = new Error('wrapped', { cause: new ClassifiedHarnessError(original) });
      // Source deliberately disagrees: the tag from the throw site must win over the caller's guess.
      expect(classifyError({ error: wrapped, source: 'internal' })).toEqual(original);
      expect(attachedClassification(wrapped)).toEqual(original);
    });

    it('reports nothing attached for a plain error', () => {
      expect(attachedClassification(new Error('plain'))).toBeUndefined();
    });
  });

  it('exposes countable log fields', () => {
    const classification = classifyError({ error: new Error('command execution timeout'), source: 'sandbox' });
    expect(classificationLogFields(classification)).toEqual({
      error_code: 'sandbox_timeout',
      error_source: 'sandbox',
      retryable: true,
    });
  });
});
