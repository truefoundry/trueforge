import { CONTEXT_COMPACTION_DATA_NAME } from '@truefoundry/trueforge-assistant-ui-runtime';
import { describe, expect, it } from 'vitest';

import {
  loaderActivityKey,
  loaderActivityProgress,
  resolveActivityLabel,
  resolveLoaderLabel,
  type ActivityPart,
} from '../../src/utils/resolveActivityLabel.js';

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

  it('reports a pending approval on a nested part without status', () => {
    expect(resolveActivityLabel([{ type: 'tool-call', toolName: 'exec', approval: {} }])).toBe(
      'Waiting for your approval',
    );
    expect(resolveActivityLabel([{ type: 'tool-call', toolName: 'exec', approval: { approved: true } }])).toBe(
      'Running command...',
    );
  });

  it('trims long runs of trailing dots in linear time', () => {
    const intent = `Inspect${'.'.repeat(100_000)}x`;
    const start = performance.now();
    resolveActivityLabel([running('exec', { argsText: JSON.stringify({ intent }) })]);
    expect(performance.now() - start).toBeLessThan(500);
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
    expect(resolveLoaderLabel([{ type: 'tool-call', toolName: 'exec', status: { type: 'requires-action' } }])).toBe(
      'Working...',
    );
  });

  it('summarizes running sub-agents in the main loader', () => {
    const subAgent = running('create_sub_agent');
    expect(resolveLoaderLabel([subAgent])).toBe('Waiting for sub-agent...');
    expect(resolveLoaderLabel([subAgent, subAgent, subAgent])).toBe('Waiting for 3 sub-agents...');
  });

  it('labels a running context summarization', () => {
    const summarizing: ActivityPart = {
      type: 'data',
      name: CONTEXT_COMPACTION_DATA_NAME,
      data: { status: 'running', started: {} },
    };
    const summarized: ActivityPart = {
      type: 'data',
      name: CONTEXT_COMPACTION_DATA_NAME,
      data: { status: 'complete', started: {}, finished: {} },
    };
    expect(resolveLoaderLabel([summarizing])).toBe('Summarizing context...');
    expect(resolveActivityLabel([summarizing])).toBe('Summarizing context...');
    expect(resolveLoaderLabel([summarized])).toBe('Working...');
    expect(resolveActivityLabel([summarized])).toBe('Working...');
  });

  it('times thinking, the model, a tool call, and summarization, and skips waits', () => {
    const summarizing: ActivityPart = {
      type: 'data',
      name: CONTEXT_COMPACTION_DATA_NAME,
      data: { status: 'running', started: {} },
    };
    expect(loaderActivityKey([])).toBe('model');
    expect(loaderActivityKey([{ type: 'reasoning' }])).toBe('thinking');
    expect(loaderActivityKey([running('exec', { toolCallId: 'call-1' })])).toBe('tool:call-1');
    expect(loaderActivityKey([summarizing])).toBe('summarizing');
    expect(
      loaderActivityKey([{ type: 'tool-call', toolName: 'exec', status: { type: 'requires-action' } }]),
    ).toBeNull();
    expect(loaderActivityKey([running('create_sub_agent')])).toBeNull();
  });

  it('fingerprints streamed reasoning text and tool args without changing for a stable tool', () => {
    const shortReasoning = loaderActivityProgress([{ type: 'reasoning', text: 'hmm' }]);
    const longReasoning = loaderActivityProgress([{ type: 'reasoning', text: 'hmm more' }]);
    expect(shortReasoning).not.toBe(longReasoning);

    const shortArgs = loaderActivityProgress([running('exec', { argsText: '{"a":1}' })]);
    const longArgs = loaderActivityProgress([running('exec', { argsText: '{"a":1,"b":2}' })]);
    expect(shortArgs).not.toBe(longArgs);

    const stable = running('exec', { toolCallId: 'call-1', argsText: '{"command":"ls"}' });
    expect(loaderActivityProgress([stable])).toBe(loaderActivityProgress([stable]));
  });
});
