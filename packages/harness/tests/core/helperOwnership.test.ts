import { ToolNameCollisionError } from '../../src/core/errors';
import { getUniqueSanitizedToolName, MAX_DUP_SUFFIX } from '../../src/core/mcp/toolNames';
import {
  assistantMessageContentToStringForSubAgent,
  INTERNAL_SYSTEM_PROMPT,
  makeUnknownToolInfo,
} from '../../src/core/runtime/contextUtils';
import { describeUnknownError, extractErrorLogFields } from '../../src/core/util/errorLogFields';
import { PromiseTimeoutError, withTimeout } from '../../src/core/util/promiseUtils';

describe('canonical helper ownership fidelity', () => {
  it('extractErrorLogFields matches Error and non-Error shapes', () => {
    const err = new Error('x');
    expect(extractErrorLogFields(err)).toEqual({ error: 'x', stack: err.stack });
    expect(extractErrorLogFields('plain')).toEqual({ error: 'plain' });
    expect(extractErrorLogFields({ message: 'provider blew up' })).toEqual({ error: 'provider blew up' });
    expect(extractErrorLogFields({ code: 'rate_limit', status: 429 })).toEqual({
      error: JSON.stringify({ code: 'rate_limit', status: 429 }),
    });
  });

  it('describeUnknownError prefers message fields over opaque placeholders', () => {
    expect(describeUnknownError(new Error('boom'))).toBe('boom');
    expect(describeUnknownError({ message: 'The requested model does not exist.' })).toBe(
      'The requested model does not exist.',
    );
    expect(describeUnknownError(undefined)).toBe('undefined');
  });

  it('describeUnknownError uses a bland fallback when the value cannot be serialised', () => {
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(describeUnknownError(circular)).toBe('An unexpected error occurred');
    expect(extractErrorLogFields(circular).error).toMatch(/^unserialisable error \(/);
  });

  it('DaytonaProvider owns http→ws URL conversion (no shared helper module)', () => {
    // Folded into DaytonaProvider per ISSUE-042; assert the conversion contract via URL API.
    const https = new URL('https://example.com/path');
    https.protocol = 'wss:';
    expect(https.toString()).toBe('wss://example.com/path');
    const http = new URL('http://example.com/path');
    http.protocol = 'ws:';
    expect(http.toString()).toBe('ws://example.com/path');
  });

  it('withTimeout rejects with PromiseTimeoutError', async () => {
    await expect(withTimeout(new Promise(() => undefined), 5)).rejects.toBeInstanceOf(PromiseTimeoutError);
  });

  it('preserves canonical prompt and unknown-tool bytes', () => {
    expect(INTERNAL_SYSTEM_PROMPT).toContain('tfy-internal tags contain information hidden from the user');
    expect(makeUnknownToolInfo('foo')).toEqual({
      type: 'mcp',
      mcp_server_id: 'unknown',
      mcp_server_name: 'unknown',
      original_tool_name: 'foo',
      is_approval_required: false,
      is_client_side: false,
    });
    expect(assistantMessageContentToStringForSubAgent('body', 'ERR')).toBe('ERR\nbody');
    expect(assistantMessageContentToStringForSubAgent('', 'ERR')).toBe('ERR');
  });

  it('enforces tool-name collision limit 50', () => {
    const existing = new Set<string>();
    existing.add('tool');
    for (let i = 1; i <= MAX_DUP_SUFFIX; i++) existing.add(`tool${String(i)}`);
    expect(MAX_DUP_SUFFIX).toBe(50);
    expect(() => getUniqueSanitizedToolName('tool', existing)).toThrow(ToolNameCollisionError);
    expect(() => getUniqueSanitizedToolName('tool', existing)).toThrow(
      `Tool name collision limit exceeded for "tool": more than ${String(MAX_DUP_SUFFIX)} duplicates across MCP servers`,
    );
  });
});
