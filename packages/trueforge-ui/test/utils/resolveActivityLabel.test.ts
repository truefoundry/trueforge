import { describe, expect, it } from 'vitest';

import { resolveActivityLabel, resolveLoaderLabel, type ActivityPart } from '../../src/utils/resolveActivityLabel.js';

const running = (toolName: string, extra: Partial<ActivityPart> = {}): ActivityPart => ({
  type: 'tool-call',
  toolName,
  status: { type: 'running' },
  ...extra,
});

describe('resolveActivityLabel', () => {
  it('says working until reasoning is actually streaming', () => {
    expect(resolveActivityLabel([])).toBe('Working...');
    expect(resolveActivityLabel([{ type: 'reasoning' }])).toBe('Thinking...');
  });

  it('describes running tools', () => {
    expect(resolveActivityLabel([running('web_search')])).toBe('Running web_search...');
    expect(resolveActivityLabel([running('exec')])).toBe('Running command...');
    expect(resolveActivityLabel([running('exec', { argsText: '{"command":"ls","intent":"Inspect result."}' })])).toBe(
      'Inspect result · exec',
    );
    expect(resolveActivityLabel([running('call_tool', { argsText: '{"tool_name":"list_issues"}' })])).toBe(
      'Running list_issues...',
    );
  });

  it('reports approval waits and finished tools', () => {
    expect(resolveActivityLabel([{ type: 'tool-call', toolName: 'exec', status: { type: 'requires-action' } }])).toBe(
      'Waiting for your approval',
    );
    expect(resolveActivityLabel([{ type: 'tool-call', toolName: 'exec', status: { type: 'complete' } }])).toBe(
      'Working...',
    );
  });

  it('surfaces the latest nested sub-agent activity', () => {
    const subAgent = running('create_sub_agent', {
      messages: [{ content: [{ type: 'tool-call', toolName: 'web_search' }] }],
    });
    expect(resolveActivityLabel([subAgent])).toBe('Sub-agent: Running web_search...');
  });

  it('keeps the main loader generic for the main agent own tools', () => {
    expect(resolveLoaderLabel([])).toBe('Working...');
    expect(resolveLoaderLabel([{ type: 'reasoning' }])).toBe('Thinking...');
    expect(resolveLoaderLabel([running('exec', { argsText: '{"intent":"Inspect result"}' })])).toBe('Working...');
  });

  it('summarizes running sub-agents in the main loader', () => {
    const subAgent = running('create_sub_agent');
    expect(resolveLoaderLabel([subAgent])).toBe('Waiting for sub-agent...');
    expect(resolveLoaderLabel([subAgent, subAgent, subAgent])).toBe('Waiting for 3 sub-agents...');
  });
});
