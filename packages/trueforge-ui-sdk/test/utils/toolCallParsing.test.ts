import { describe, expect, it } from 'vitest';

import {
  buildApprovalOptions,
  formatDuration,
  getAskUserAnswerResult,
  getJsonDisplayValue,
  getToolResultContent,
  mcpDisplayName,
  parseAskUserQuestionArgs,
  parseMcpToolArgs,
  parseSandboxArgs,
  parseSandboxResult,
  toStatus,
} from '@/utils/toolCallParsing.js';

describe('toolCallParsing', () => {
  it('parses ask-user args', () => {
    expect(parseAskUserQuestionArgs(JSON.stringify({ question: 'Pick one', options: ['a', 'b', 3] }))).toEqual({
      question: 'Pick one',
      options: ['a', 'b'],
    });
    expect(parseAskUserQuestionArgs('not-json')).toEqual({});
  });

  it('reads ask-user answers from string or content object', () => {
    expect(getAskUserAnswerResult('  yes  ')).toBe('yes');
    expect(getAskUserAnswerResult({ content: 'no' })).toBe('no');
    expect(getAskUserAnswerResult('')).toBeUndefined();
  });

  it('formats durations', () => {
    expect(formatDuration(500)).toBe('<1s');
    expect(formatDuration(1500)).toBe('1.5s');
    expect(formatDuration(15000)).toBe('15s');
    expect(formatDuration(125000)).toBe('2m 5s');
  });

  it('maps status types', () => {
    expect(toStatus('complete')).toBe('success');
    expect(toStatus('incomplete')).toBe('error');
    expect(toStatus('running')).toBe('running');
  });

  it('parses sandbox args and results', () => {
    expect(parseSandboxArgs(JSON.stringify({ command: 'ls', intent: 'list' }))).toMatchObject({
      command: 'ls',
      intent: 'list',
    });
    expect(parseSandboxArgs('{"command":"pnpm test","intent":"still stream')).toEqual({
      command: 'pnpm test',
      intent: 'still stream',
      argsJson: '{"command":"pnpm test","intent":"still stream',
    });
    expect(parseSandboxResult(JSON.stringify({ response: { exitCode: 0, result: 'ok' } }))).toMatchObject({
      exitCode: 0,
      resultText: 'ok',
    });
    expect(parseSandboxResult('{"response":{"exitCode":0,"result":"streamed output"')).toEqual({
      exitCode: 0,
      resultText: 'streamed output',
      resultJson: '{"response":{"exitCode":0,"result":"streamed output"',
    });
    expect(parseSandboxResult('plain')).toEqual({ resultText: 'plain' });
  });

  it('parses mcp tool args and display names', () => {
    expect(
      parseMcpToolArgs(
        JSON.stringify({
          mcp_server: 'github',
          tool_name: 'search',
          input: { q: 'x' },
        }),
      ),
    ).toEqual({
      mcpServer: 'github',
      innerToolName: 'search',
      input: { q: 'x' },
    });
    expect(mcpDisplayName('call_tool', 'github', 'search')).toBe('call_tool: search (github)');
  });

  it('pretty-prints json display values', () => {
    expect(getJsonDisplayValue('{"a":1}')).toEqual({
      value: '{\n  "a": 1\n}',
      isJson: true,
    });
    expect(getJsonDisplayValue('{"a":1,"streaming":"unfinished')).toEqual({
      value: '{"a":1,"streaming":"unfinished',
      isJson: false,
    });
    expect(getJsonDisplayValue('hello')).toEqual({
      value: 'hello',
      isJson: false,
    });
  });

  it('extracts tool result content arrays', () => {
    expect(getToolResultContent({ content: [{ text: '{"ok":true}' }] })).toEqual({
      data: '{\n  "ok": true\n}',
      isJson: true,
    });
  });

  it('builds default approval options when none declared', () => {
    expect(buildApprovalOptions(undefined)).toEqual([
      { id: '__allow', label: 'Allow', isAllow: true },
      { id: '__deny', label: 'Deny', isAllow: false, confirm: {} },
    ]);
  });
});
