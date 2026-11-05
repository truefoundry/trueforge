import { render, screen } from '@testing-library/react';
import type { ContextCompactionPartData } from '@truefoundry/trueforge-assistant-ui-runtime';
import { describe, expect, it } from 'vitest';

import type { ToolCallContentBlockProps } from '@/atoms/ToolCallContentBlock.js';
import { ContextCompactionCard } from '@/atoms/adapters/ContextCompactionCardAdapter.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

function ContentBlockProbe({ content, copyValue }: ToolCallContentBlockProps) {
  return (
    <pre data-testid="event-json" data-copy-value={copyValue}>
      {content}
    </pre>
  );
}

describe('ContextCompactionCard', () => {
  it.each(['running', 'complete', 'cancelled', 'error'] as const)(
    'rounds context tokens up for %s events without mutating the source',
    status => {
      const started: ContextCompactionPartData['started'] = {
        type: 'thread.context_compaction_started',
        id: 'compaction-started',
        createdAt: '2026-11-03T06:05:59.344Z',
        threadId: 'thread-1',
        trigger: { type: 'context_threshold_exceeded', contextTokens: 80_545.5, thresholdTokens: 80_000 },
      };
      const finished = {
        ...started,
        type: 'thread.context_compaction_finished' as const,
        durationMs: 1234.5,
      };
      const data: ContextCompactionPartData =
        status === 'complete'
          ? { status, started, finished }
          : status === 'running'
            ? { status, started }
            : { status: 'incomplete', reason: status, started };
      const event = status === 'complete' ? finished : started;
      const expected = JSON.stringify({ ...event, trigger: { ...event.trigger, contextTokens: 80_546 } }, null, 2);

      render(
        <SlotsProvider overrides={{ ToolCallContentBlock: ContentBlockProbe }}>
          <ContextCompactionCard data={data} expanded />
        </SlotsProvider>,
      );

      expect(screen.getByTestId('event-json').textContent).toBe(expected);
      expect(screen.getByTestId('event-json')).toHaveAttribute('data-copy-value', expected);
      expect(event.trigger.contextTokens).toBe(80_545.5);
    },
  );

  it.each([0, 80_546])('preserves integer context token counts (%s)', contextTokens => {
    const data: ContextCompactionPartData = {
      status: 'running',
      started: {
        type: 'thread.context_compaction_started',
        id: 'compaction-started',
        createdAt: '2026-11-03T06:05:59.344Z',
        threadId: 'thread-1',
        trigger: { type: 'context_threshold_exceeded', contextTokens, thresholdTokens: 80_000 },
      },
    };

    render(
      <SlotsProvider overrides={{ ToolCallContentBlock: ContentBlockProbe }}>
        <ContextCompactionCard data={data} expanded />
      </SlotsProvider>,
    );

    expect(screen.getByTestId('event-json').textContent).toBe(JSON.stringify(data.started, null, 2));
  });
});
