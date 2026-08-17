// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Markdown } from '@/atoms/Markdown.js';
import { ToolCallContentBlock } from '@/atoms/ToolCallContentBlock.js';
import { SlotsProvider } from '@/theme/SlotsProvider.js';

vi.mock('@/atoms/MonacoEditorCore.js', () => ({
  MonacoEditorCore: ({
    value,
    language,
    height,
    autoHeight,
    options,
  }: {
    value: string;
    language?: string;
    height?: string | number;
    autoHeight?: boolean;
    options?: Record<string, unknown>;
  }) => (
    <div
      data-testid="json-editor"
      data-language={language}
      data-height={String(height)}
      data-auto-height={String(Boolean(autoHeight))}
      data-read-only={String(options?.readOnly)}
    >
      {value}
    </div>
  ),
}));

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

function MarkdownStub({ content }: ComponentProps<typeof Markdown>) {
  return <div data-testid="markdown-content">{content}</div>;
}

function renderBlock(props: ComponentProps<typeof ToolCallContentBlock>) {
  return render(
    <SlotsProvider overrides={{ Markdown: MarkdownStub }}>
      <ToolCallContentBlock {...props} />
    </SlotsProvider>,
  );
}

describe('ToolCallContentBlock', () => {
  const writeText = vi.fn(() => Promise.resolve());

  beforeAll(() => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value: function showModal(this: HTMLDialogElement) {
        this.open = true;
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value: function close(this: HTMLDialogElement) {
        this.open = false;
      },
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (clipboardDescriptor === undefined) {
      Reflect.deleteProperty(navigator, 'clipboard');
    } else {
      Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    }
  });

  it('renders JSON read-only and copies the configured copy value', async () => {
    vi.useFakeTimers();
    renderBlock({
      title: 'Arguments',
      content: '{"token":"redacted"}',
      copyValue: '{"token":"actual"}',
      dataTestPrefix: 'args',
    });

    expect(screen.getByTestId('json-editor')).toHaveAttribute('data-language', 'json');
    expect(screen.getByTestId('json-editor')).toHaveAttribute('data-read-only', 'true');
    expect(screen.getByTestId('json-editor')).toHaveAttribute('data-auto-height', 'true');

    await act(async () => {
      fireEvent.click(screen.getByTestId('args-copy'));
      await Promise.resolve();
    });
    expect(writeText).toHaveBeenCalledWith('{"token":"actual"}');
    expect(writeText).toHaveBeenCalledOnce();

    act(() => {
      vi.advanceTimersByTime(1500);
    });
  });

  it('renders markdown, clamps resizable height, and provides the content node', () => {
    const contentRef = vi.fn();
    renderBlock({
      title: 'Response',
      content: '**done**',
      isJson: false,
      resizable: true,
      contentHeightRem: 25,
      contentRef,
    });

    expect(screen.getByTestId('markdown-content')).toHaveTextContent('**done**');
    expect(screen.queryByTestId('json-editor')).not.toBeInTheDocument();
    const body = screen.getByTestId('markdown-content').parentElement?.parentElement;
    expect(body).toHaveStyle({ height: '10rem', resize: 'vertical' });
    expect(body).toHaveClass('overflow-hidden');
    expect(contentRef).toHaveBeenCalledWith(body);
  });

  it('lets Monaco own scrolling after the resizable body is measured', () => {
    renderBlock({
      title: 'Response',
      content: '{"items":[1,2,3]}',
      resizable: true,
      contentHeightRem: 8,
    });

    const editor = screen.getByTestId('json-editor');
    expect(editor).toHaveAttribute('data-height', '100%');
    expect(editor).toHaveAttribute('data-auto-height', 'false');
    expect(editor.parentElement).toHaveClass('overflow-hidden');
  });

  it('requests fullscreen and closes the controlled fullscreen dialog', () => {
    const onFullscreenChange = vi.fn();
    const { rerender } = renderBlock({
      title: 'Tool output',
      content: '{"ok":true}',
      onFullscreenChange,
    });

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(onFullscreenChange).toHaveBeenCalledWith(true);

    rerender(
      <SlotsProvider overrides={{ Markdown: MarkdownStub }}>
        <ToolCallContentBlock
          title="Tool output"
          content='{"ok":true}'
          fullscreen
          onFullscreenChange={onFullscreenChange}
        />
      </SlotsProvider>,
    );

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getAllByTestId('json-editor')).toHaveLength(2);
    expect(screen.getAllByTestId('json-editor')[1]).toHaveAttribute('data-height', '100%');

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }));
    expect(onFullscreenChange).toHaveBeenLastCalledWith(false);
  });
});
