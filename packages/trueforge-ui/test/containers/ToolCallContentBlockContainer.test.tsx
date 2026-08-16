// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useCallback } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ToolCallContentBlockProps } from '@/atoms/ToolCallContentBlock.js';
import { ToolCallContentBlockContainer } from '@/containers/ToolCallContentBlockContainer.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

let observedNodes: Element[] = [];
let disconnectCount = 0;
let reportContentHeight = true;
let renderedContentHeight = 0;

class ResizeObserverProbe implements ResizeObserver {
  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    observedNodes.push(target);
    this.callback([], this);
  }

  unobserve() {}

  disconnect() {
    disconnectCount += 1;
  }
}

function ToolCallContentBlockProbe({
  title,
  content,
  isJson,
  copyValue,
  maxHeight,
  resizable,
  fullscreen,
  onFullscreenChange,
  contentHeightRem,
  contentRef,
  onContentHeightChange,
}: ToolCallContentBlockProps) {
  const measuredContentRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (node !== null) {
        Object.defineProperty(node, 'scrollHeight', { configurable: true, value: 64 });
        Object.defineProperty(node, 'getBoundingClientRect', {
          configurable: true,
          value: () => new DOMRect(0, 0, 100, renderedContentHeight),
        });
      }
      if (resizable) {
        contentRef?.(node);
        if (node !== null && reportContentHeight) onContentHeightChange?.(64);
      }
    },
    [contentRef, onContentHeightChange, resizable],
  );

  return (
    <section
      data-testid="content-block-probe"
      data-title={title}
      data-content={content}
      data-json={String(isJson)}
      data-copy-value={copyValue}
      data-max-height={maxHeight}
      data-resizable={String(resizable)}
      data-fullscreen={String(fullscreen)}
      data-content-height={String(contentHeightRem)}
    >
      <div ref={measuredContentRef}>content node</div>
      <button type="button" onClick={() => onFullscreenChange?.(true)}>
        Enter fullscreen
      </button>
      <button type="button" onClick={() => onFullscreenChange?.(false)}>
        Exit fullscreen
      </button>
    </section>
  );
}

function TestSubject({ resizable = false }: { resizable?: boolean }) {
  return (
    <SlotsProvider overrides={{ ToolCallContentBlock: ToolCallContentBlockProbe }}>
      <ToolCallContentBlockContainer
        title="Tool result"
        content='{"ok":true}'
        isJson
        copyValue="raw result"
        maxHeight="20rem"
        resizable={resizable}
      />
    </SlotsProvider>
  );
}

describe('ToolCallContentBlockContainer', () => {
  beforeEach(() => {
    observedNodes = [];
    disconnectCount = 0;
    reportContentHeight = true;
    renderedContentHeight = 0;
    vi.stubGlobal('ResizeObserver', ResizeObserverProbe);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards content configuration and owns fullscreen state', () => {
    render(<TestSubject />);

    const probe = screen.getByTestId('content-block-probe');
    expect(probe).toHaveAttribute('data-title', 'Tool result');
    expect(probe).toHaveAttribute('data-content', '{"ok":true}');
    expect(probe).toHaveAttribute('data-json', 'true');
    expect(probe).toHaveAttribute('data-copy-value', 'raw result');
    expect(probe).toHaveAttribute('data-max-height', '20rem');
    expect(probe).toHaveAttribute('data-fullscreen', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Enter fullscreen' }));
    expect(probe).toHaveAttribute('data-fullscreen', 'true');

    fireEvent.click(screen.getByRole('button', { name: 'Exit fullscreen' }));
    expect(probe).toHaveAttribute('data-fullscreen', 'false');
  });

  it('measures resizable content and disconnects its observer on unmount', async () => {
    const { unmount } = render(<TestSubject resizable />);

    await waitFor(() => {
      expect(screen.getByTestId('content-block-probe')).toHaveAttribute('data-content-height', '4');
    });
    expect(observedNodes).toHaveLength(1);

    const disconnectsBeforeUnmount = disconnectCount;
    unmount();
    expect(disconnectCount).toBeGreaterThan(disconnectsBeforeUnmount);
  });

  it('does not lock JSON height before Monaco reports its measured content height', () => {
    reportContentHeight = false;
    render(<TestSubject resizable />);

    expect(screen.getByTestId('content-block-probe')).toHaveAttribute('data-content-height', 'undefined');
  });

  it('preserves the rendered box height when Monaco finishes measuring', async () => {
    renderedContentHeight = 72;
    render(<TestSubject resizable />);

    await waitFor(() => {
      expect(screen.getByTestId('content-block-probe')).toHaveAttribute('data-content-height', '4.5');
    });
  });
});
