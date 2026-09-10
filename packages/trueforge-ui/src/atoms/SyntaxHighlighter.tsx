'use client';

import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useMemo,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { Prism as PrismHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { Icon } from '../icons/Icon.js';
import { useOptionalContentClassNames } from '../theme/ThemeProvider.js';
import { auiButtonClass } from './lib/buttonClasses.js';
import { cn } from './lib/cn.js';

export type SyntaxHighlighterProps = {
  code: string;
  language?: string;
  darkTheme?: boolean;
  className?: string;
  showLineNumbers?: boolean;
};

/** Drop a single trailing newline so line numbers do not paint an empty last row. */
export function stripTrailingNewline(code: string): string {
  return code.endsWith('\n') ? code.slice(0, -1) : code;
}

function applyLineNumberClassName(children: ReactNode, className: string | undefined): ReactNode {
  if (!className) return children;

  return Children.map(children, child => {
    if (
      !isValidElement<{ className?: string }>(child) ||
      !child.props.className?.includes('react-syntax-highlighter-line-number')
    ) {
      return child;
    }

    return cloneElement(child, { className: cn(child.props.className, className) });
  });
}

function SyntaxHighlighterImpl({ code, language, darkTheme, className, showLineNumbers }: SyntaxHighlighterProps) {
  const classNames = useOptionalContentClassNames();
  const style = darkTheme ? oneDark : oneLight;
  const [copied, setCopied] = useState(false);
  const displayCode = useMemo(() => stripTrailingNewline(code), [code]);

  const handleCopy = useCallback(() => {
    void navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [code]);

  return (
    <div
      className={cn(
        'aui-syntax-highlighter relative my-2 max-w-full min-w-0 overflow-x-auto rounded-md',
        classNames.syntaxHighlighter?.root,
        className,
      )}
    >
      <button
        type="button"
        onClick={handleCopy}
        title={copied ? 'Copied!' : 'Copy'}
        aria-label={copied ? 'Copied!' : 'Copy'}
        className={auiButtonClass({
          variant: 'secondary',
          size: 'icon',
          className: 'absolute top-2 right-2 z-10 h-7 w-7',
        })}
      >
        <Icon name={copied ? 'check' : 'copy'} size="0.875em" />
      </button>
      <PrismHighlighter
        language={language}
        style={style}
        customStyle={{ margin: 0, maxWidth: '100%', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
        wrapLongLines
        showLineNumbers={showLineNumbers}
        PreTag={({ children, className: preClass, ...rest }) => (
          <pre
            {...rest}
            className={cn(
              'max-w-full overflow-x-auto whitespace-pre-wrap break-words',
              classNames.syntaxHighlighter?.pre,
              preClass,
            )}
          >
            {children}
          </pre>
        )}
        CodeTag={({ children, className: codeClass, ...rest }) => (
          <code
            {...rest}
            className={cn('whitespace-pre-wrap break-words', classNames.syntaxHighlighter?.code, codeClass)}
          >
            {applyLineNumberClassName(children, classNames.syntaxHighlighter?.lineNumber)}
          </code>
        )}
      >
        {displayCode}
      </PrismHighlighter>
    </div>
  );
}

export const SyntaxHighlighter: ComponentType<SyntaxHighlighterProps> = memo(SyntaxHighlighterImpl);

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SyntaxHighlighter: typeof SyntaxHighlighter;
  }
}
