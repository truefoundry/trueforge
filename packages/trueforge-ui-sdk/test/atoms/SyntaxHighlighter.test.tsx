// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

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
    PreTag,
    CodeTag,
  }: {
    children?: ReactNode;
    language?: string;
    style?: unknown;
    showLineNumbers?: boolean;
    PreTag?: ComponentType<{ children?: ReactNode; className?: string }>;
    CodeTag?: ComponentType<{ children?: ReactNode; className?: string }>;
  }) => (
    <div
      data-testid="syntax-engine"
      data-language={language}
      data-theme={style === syntaxMocks.dark ? 'dark' : 'light'}
      data-line-numbers={String(Boolean(showLineNumbers))}
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

describe('SyntaxHighlighter', () => {
  it('passes code, language, and line-number behavior to the highlighting engine', () => {
    render(<SyntaxHighlighter code={'const x = 1;\nconsole.log(x);'} language="typescript" showLineNumbers />);

    const highlighter = screen.getByTestId('syntax-engine');
    expect(highlighter).toHaveAttribute('data-language', 'typescript');
    expect(highlighter).toHaveAttribute('data-line-numbers', 'true');
    expect(highlighter).toHaveTextContent('const x = 1;');
    expect(highlighter).toHaveTextContent('console.log(x);');
    expect(highlighter.querySelector('pre')).toHaveClass('engine-pre', 'max-w-full', 'overflow-x-auto');
    expect(highlighter.querySelector('code')).toHaveClass('engine-code');
  });

  it('switches the highlighting theme and preserves consumer classes', () => {
    const { container, rerender } = render(<SyntaxHighlighter code="value" className="consumer-class" />);

    expect(screen.getByTestId('syntax-engine')).toHaveAttribute('data-theme', 'light');
    expect(container.querySelector('.aui-syntax-highlighter')).toHaveClass('consumer-class');

    rerender(<SyntaxHighlighter code="value" darkTheme className="consumer-class" />);
    expect(screen.getByTestId('syntax-engine')).toHaveAttribute('data-theme', 'dark');
  });
});
