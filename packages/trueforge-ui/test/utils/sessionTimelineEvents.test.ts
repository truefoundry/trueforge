import { describe, expect, it } from 'vitest';

import { toolCallDescription } from '@/utils/sessionTimelineEvents.js';

describe('toolCallDescription', () => {
  it('shows sandbox intent instead of the exec tool name', () => {
    expect(
      toolCallDescription({
        function: {
          name: 'exec',
          arguments: JSON.stringify({ command: 'ls', intent: 'List workspace files' }),
        },
      }),
    ).toBe('List workspace files');
    expect(
      toolCallDescription({
        function: { name: 'sandbox_exec', arguments: '{"intent":"Generate a PDF"}' },
      }),
    ).toBe('Generate a PDF');
  });

  it('falls back to the tool name when intent is missing', () => {
    expect(toolCallDescription({ function: { name: 'exec', arguments: '{"command":"ls"}' } })).toBe('exec');
    expect(toolCallDescription({ function: { name: 'search', arguments: '{"q":"x"}' } })).toBe('search');
  });
});
