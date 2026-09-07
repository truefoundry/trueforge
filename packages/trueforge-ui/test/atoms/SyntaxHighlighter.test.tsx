// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SyntaxHighlighter } from '@/atoms/SyntaxHighlighter.js';

const syntaxMocks = vi.hoisted(() => ({
  dark: { name: 'dark' },
  light: { name: 'light' },
}));

vi.mock('react-syntax-highlighter/dist/esm/styles/prism', () => ({
  oneDark: syntaxMocks.dark,
  oneLight: syntaxMocks.light,
}));

vi.mock('react-syntax-highlighter', () => ({
  Prism: ({
    children,
    language,
    style,
    showLineNumbers,
    wrapLongLines,
    PreTag,
    CodeTag,
  }: {
    children?: ReactNode;
    language?: string;
    style?: unknown;
    showLineNumbers?: boolean;
    wrapLongLines?: boolean;
    PreTag?: ComponentType<{ children?: ReactNode; className?: string }>;
    CodeTag?: ComponentType<{ children?: ReactNode; className?: string }>;
  }) => (
    <div
      data-testid="syntax-engine"
      data-language={language}
      data-theme={style === syntaxMocks.dark ? 'dark' : 'light'}
      data-line-numbers={String(Boolean(showLineNumbers))}
      data-wrap-long-lines={String(Boolean(wrapLongLines))}
    >
      {PreTag ? (
        <PreTag className="engine-pre">
          {CodeTag ? <CodeTag className="engine-code">{children}</CodeTag> : children}
        </PreTag>
      ) : (
        children
      )}
    </div>
  ),
}));

const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

describe('SyntaxHighlighter', () => {
  const writeText = vi.fn(() => Promise.resolve());

  beforeEach(() => {
    writeText.mockClear();
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

  it('passes code, language, and line-number behavior to the highlighting engine', () => {
    render(<SyntaxHighlighter code={'const x = 1;\nconsole.log(x);'} language="typescript" showLineNumbers />);

    const highlighter = screen.getByTestId('syntax-engine');
    expect(highlighter).toHaveAttribute('data-language', 'typescript');
    expect(highlighter).toHaveAttribute('data-line-numbers', 'true');
    expect(highlighter).toHaveAttribute('data-wrap-long-lines', 'true');
    expect(highlighter).toHaveTextContent('const x = 1;');
    expect(highlighter).toHaveTextContent('console.log(x);');
    expect(highlighter.querySelector('pre')).toHaveClass(
      'engine-pre',
      'max-w-full',
      'overflow-x-auto',
      'whitespace-pre-wrap',
      'break-words',
    );
    expect(highlighter.querySelector('code')).toHaveClass('engine-code', 'whitespace-pre-wrap', 'break-words');
  });

  it('switches the highlighting theme and preserves consumer classes', () => {
    const { container, rerender } = render(<SyntaxHighlighter code="value" className="consumer-class" />);

    expect(screen.getByTestId('syntax-engine')).toHaveAttribute('data-theme', 'light');
    expect(container.querySelector('.aui-syntax-highlighter')).toHaveClass('consumer-class');

    rerender(<SyntaxHighlighter code="value" darkTheme className="consumer-class" />);
    expect(screen.getByTestId('syntax-engine')).toHaveAttribute('data-theme', 'dark');
  });

  it('copies the code and reports the copied state', async () => {
    vi.useFakeTimers();
    render(<SyntaxHighlighter code="copy me" />);

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
    vi.useRealTimers();
  });

  it('strips a trailing newline so line numbers do not show an empty last row', () => {
    render(<SyntaxHighlighter code={'const x = 1;\n'} showLineNumbers />);

    expect(screen.getByTestId('syntax-engine')).toHaveTextContent('const x = 1;');
    expect(screen.getByTestId('syntax-engine').textContent).not.toMatch(/\n$/);
  });

  it('copies the exact source including a trailing newline', async () => {
    render(<SyntaxHighlighter code={'copy me\n'} />);

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledWith('copy me\n');
  });
});
