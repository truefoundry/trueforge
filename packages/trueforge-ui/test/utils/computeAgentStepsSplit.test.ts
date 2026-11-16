import { describe, expect, it } from 'vitest';

import { computeAgentStepsSplit, type AgentStepPart } from '@/index.js';
import { countAgentSteps } from '@/utils/computeAgentStepsSplit.js';

function text(content: string): AgentStepPart {
  return { type: 'text', text: content };
}

function tool(): AgentStepPart {
  return { type: 'tool-call' };
}

function reasoning(): AgentStepPart {
  return { type: 'reasoning', text: 'thinking' };
}

function compaction(): AgentStepPart {
  return { type: 'data', name: 'thread.context_compaction' };
}

describe('computeAgentStepsSplit', () => {
  it('treats pure text as final immediately while running', () => {
    const parts = [text('hello world')];
    const result = computeAgentStepsSplit(parts, true);
    expect(result.cutIndex).toBe(0);
    expect(result.hasFinal).toBe(true);
  });

  it('holds back short trailing text while running when tools precede it', () => {
    const parts = [tool(), text('hi')];
    const result = computeAgentStepsSplit(parts, true);
    expect(result.hasFinal).toBe(false);
    expect(result.cutIndex).toBe(parts.length);
  });

  it('confirms final text once trailing content is long enough', () => {
    const parts = [tool(), reasoning(), text('x'.repeat(500))];
    const result = computeAgentStepsSplit(parts, true);
    expect(result.hasFinal).toBe(true);
    expect(result.cutIndex).toBe(2);
    expect(countAgentSteps(parts.slice(0, result.cutIndex))).toEqual({ toolCount: 1, thinkingCount: 1 });
  });

  it('confirms final when not running', () => {
    const parts = [tool(), text('done')];
    const result = computeAgentStepsSplit(parts, false);
    expect(result.hasFinal).toBe(true);
    expect(result.cutIndex).toBe(1);
  });

  it('treats context compaction as an agent step for the trailing-text holdback', () => {
    const parts = [compaction(), text('hi')];
    const result = computeAgentStepsSplit(parts, true);
    expect(result.hasFinal).toBe(false);
    expect(result.cutIndex).toBe(parts.length);
  });

  it('does not hold back text after an answered question that is the only tool call', () => {
    const parts = [{ ...tool(), hidden: true }, text('hi')];
    const result = computeAgentStepsSplit(parts, true);
    expect(result.hasFinal).toBe(true);
    expect(result.cutIndex).toBe(1);
  });

  it('excludes hidden parts from counts', () => {
    expect(countAgentSteps([tool(), { ...tool(), hidden: true }, reasoning()])).toEqual({
      toolCount: 1,
      thinkingCount: 1,
    });
  });
});
