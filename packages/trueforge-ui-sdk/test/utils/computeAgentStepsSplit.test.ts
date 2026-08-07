import { describe, expect, it } from 'vitest';

import { computeAgentStepsSplit, type AgentStepPart } from '@/index.js';

function text(content: string): AgentStepPart {
  return { type: 'text', text: content };
}

function tool(): AgentStepPart {
  return { type: 'tool-call' };
}

function reasoning(): AgentStepPart {
  return { type: 'reasoning', text: 'thinking' };
}

describe('computeAgentStepsSplit', () => {
  it('treats pure text as final immediately while running', () => {
    const parts = [text('hello world')];
    const result = computeAgentStepsSplit(parts, true);
    expect(result.cutIndex).toBe(0);
    expect(result.hasFinal).toBe(true);
    expect(result.toolCount).toBe(0);
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
    expect(result.toolCount).toBe(1);
    expect(result.thinkingCount).toBe(1);
  });

  it('confirms final when not running', () => {
    const parts = [tool(), text('done')];
    const result = computeAgentStepsSplit(parts, false);
    expect(result.hasFinal).toBe(true);
    expect(result.cutIndex).toBe(1);
  });
});
