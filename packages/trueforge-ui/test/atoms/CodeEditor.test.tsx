// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CodeEditor } from '@/atoms/CodeEditor.js';

vi.mock('@/atoms/MonacoEditorCore.js', () => ({
  MonacoEditorCore: ({
    value,
    height,
    options,
    onChange,
    onMount,
    beforeMount,
  }: {
    value: string;
    height?: string | number;
    options?: Record<string, unknown>;
    onChange?: (value: string) => void;
    onMount?: (editor: unknown, monaco: unknown) => void;
    beforeMount?: (monaco: unknown) => void;
  }) => (
    <div
      data-testid="monaco-editor"
      data-value={value}
      data-height={String(height)}
      data-line-numbers={String(options?.lineNumbers)}
      data-render-final-newline={String(options?.renderFinalNewline)}
    >
      <button type="button" onClick={() => onChange?.('edited')}>
        Edit
      </button>
      <button type="button" onClick={() => beforeMount?.('monaco-api')}>
        Before mount
      </button>
      <button type="button" onClick={() => onMount?.('editor-api', 'monaco-api')}>
        Mount
      </button>
    </div>
  ),
}));

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
const createObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
const revokeObjectURLDescriptor = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');

describe('CodeEditor', () => {
  const writeText = vi.fn(() => Promise.resolve());
  const createObjectURL = vi.fn(() => 'blob:test-download');
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    if (clipboardDescriptor === undefined) {
      Reflect.deleteProperty(navigator, 'clipboard');
    } else {
      Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    }
    if (createObjectURLDescriptor === undefined) {
      Reflect.deleteProperty(URL, 'createObjectURL');
    } else {
      Object.defineProperty(URL, 'createObjectURL', createObjectURLDescriptor);
    }
    if (revokeObjectURLDescriptor === undefined) {
      Reflect.deleteProperty(URL, 'revokeObjectURL');
    } else {
      Object.defineProperty(URL, 'revokeObjectURL', revokeObjectURLDescriptor);
    }
    vi.restoreAllMocks();
  });

  it('renders the toolbar, toggles line numbers, and forwards editor changes', () => {
    const onChange = vi.fn();
    const beforeMount = vi.fn();
    const onMount = vi.fn();
    render(
      <CodeEditor
        value="const answer = 42;"
        filename="answer.ts"
        language="typescript"
        onChange={onChange}
        beforeMount={beforeMount}
        onMount={onMount}
      />,
    );

    expect(screen.getByText('answer.ts')).toBeInTheDocument();
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-line-numbers', 'off');

    fireEvent.click(screen.getByRole('button', { name: 'Show line numbers' }));
    expect(screen.getByRole('button', { name: 'Hide line numbers' })).toBeInTheDocument();
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-line-numbers', 'on');

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(onChange).toHaveBeenCalledWith('edited');
    fireEvent.click(screen.getByRole('button', { name: 'Before mount' }));
    expect(beforeMount).toHaveBeenCalledWith('monaco-api');
    fireEvent.click(screen.getByRole('button', { name: 'Mount' }));
    expect(onMount).toHaveBeenCalledWith('editor-api', 'monaco-api');
  });

  it('copies the current value and reports the copied state', async () => {
    vi.useFakeTimers();
    render(<CodeEditor value="copy me" />);

    const copyButton = screen.getByRole('button', { name: 'Copy' });
    expect(copyButton.className).toMatch(/border/);

    await act(async () => {
      fireEvent.click(copyButton);
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('copy me');
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByRole('button', { name: 'Copy' })).toBeInTheDocument();
  });

  it('disables Monaco final-newline rendering so a trailing \\n is not an empty row', () => {
    render(<CodeEditor value={'line\n'} />);
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-render-final-newline', 'off');
  });

  it('expands and collapses the editor while keeping Monaco fill-height', () => {
    const { container } = render(<CodeEditor value="code" height={240} />);
    const root = container.querySelector('.aui-code-editor');

    expect(root).not.toHaveClass('fixed');
    expect(screen.getByTestId('monaco-editor')).toHaveAttribute('data-height', '100%');

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(root).toHaveClass('fixed');
    expect(screen.getByRole('button', { name: 'Collapse' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse' }));
    expect(root).not.toHaveClass('fixed');
  });

  it('downloads the current value using the filename', () => {
    let clickedDownload: string | undefined;
    let clickedHref: string | undefined;
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      clickedDownload = this.download;
      clickedHref = this.href;
    });
    render(<CodeEditor value="download me" filename="result.ts" language="typescript" />);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));

    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(clickedDownload).toBe('result.ts');
    expect(clickedHref).toBe('blob:test-download');
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-download');
  });

  it('hides all toolbar actions when requested', () => {
    render(<CodeEditor value="code" filename="hidden.ts" showToolbar={false} />);

    expect(screen.queryByText('hidden.ts')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copy' })).not.toBeInTheDocument();
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });
});
