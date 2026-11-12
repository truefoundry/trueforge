import { describe, expect, it } from 'vitest';

import {
  isParallelToolGroupPart,
  parallelGroupKeyForPart,
  readParallelToolGroups,
} from '@/utils/parallelToolGroups.js';

describe('parallelToolGroups', () => {
  it('reads a valid toolCallId map from message custom metadata', () => {
    expect(readParallelToolGroups({ parallelToolGroups: { a: 'm1', b: 'm1' } })).toEqual({
      a: 'm1',
      b: 'm1',
    });
    expect(readParallelToolGroups({})).toBeUndefined();
    expect(readParallelToolGroups(null)).toBeUndefined();
  });

  it('groups only when two or more non-sub-agent tools share a model.message id', () => {
    const parts = [
      { type: 'tool-call', toolCallId: 'a', toolName: 'one' },
      { type: 'tool-call', toolCallId: 'b', toolName: 'two' },
      { type: 'tool-call', toolCallId: 'spawn', toolName: 'create_sub_agent' },
      { type: 'tool-call', toolCallId: 'c', toolName: 'three' },
    ];
    const parallelToolGroups = { a: 'm1', b: 'm1', spawn: 'm1', c: 'm2' };

    expect(parallelGroupKeyForPart({ part: parts[0]!, parts, parallelToolGroups })).toBe('group-parallel-m1-a');
    expect(parallelGroupKeyForPart({ part: parts[1]!, parts, parallelToolGroups })).toBe('group-parallel-m1-a');
    expect(parallelGroupKeyForPart({ part: parts[2]!, parts, parallelToolGroups })).toBeNull();
    expect(parallelGroupKeyForPart({ part: parts[3]!, parts, parallelToolGroups })).toBeNull();
  });

  it('keeps ask-user calls out of parallel groups and their count', () => {
    const parts = [
      { type: 'tool-call', toolCallId: 'a', toolName: 'one' },
      { type: 'tool-call', toolCallId: 'b', toolName: 'two' },
      { type: 'tool-call', toolCallId: 'ask', toolName: 'ask_user_question' },
      { type: 'tool-call', toolCallId: 'c', toolName: 'three' },
      { type: 'tool-call', toolCallId: 'ask2', toolName: 'ask_user_question' },
    ];
    const parallelToolGroups = { a: 'm1', b: 'm1', ask: 'm1', c: 'm2', ask2: 'm2' };

    // m2 has one real tool plus an ask-user prompt, so it stays ungrouped.
    expect(parts.map(part => parallelGroupKeyForPart({ part, parts, parallelToolGroups }))).toEqual([
      'group-parallel-m1-a',
      'group-parallel-m1-a',
      null,
      null,
      null,
    ]);
  });

  it('counts only the adjacent run, so an ungrouped call in the middle splits the batch', () => {
    const parts = [
      { type: 'tool-call', toolCallId: 'a', toolName: 'one' },
      { type: 'tool-call', toolCallId: 'spawn', toolName: 'create_sub_agent' },
      { type: 'tool-call', toolCallId: 'b', toolName: 'two' },
      { type: 'tool-call', toolCallId: 'c', toolName: 'three' },
    ];
    const parallelToolGroups = { a: 'm1', spawn: 'm1', b: 'm1', c: 'm1' };

    // `a` is alone before the sub-agent, so it renders as a plain card; `b` and `c` form their own run.
    expect(parts.map(part => parallelGroupKeyForPart({ part, parts, parallelToolGroups }))).toEqual([
      null,
      null,
      'group-parallel-m1-b',
      'group-parallel-m1-b',
    ]);
  });

  it('detects parallel group part types', () => {
    expect(isParallelToolGroupPart({ type: 'group-parallel-m1-a' })).toBe(true);
    expect(isParallelToolGroupPart({ type: 'tool-call' })).toBe(false);
  });
});
