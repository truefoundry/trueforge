'use client';

import { Children, cloneElement, isValidElement, type ReactNode } from 'react';
import { Prism as PrismHighlighter } from 'react-syntax-highlighter';
import { oneDark, oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

import { useOptionalContentClassNames } from '../theme/ThemeProvider.js';
import { cn } from './lib/cn.js';

export type SyntaxHighlighterProps = {
  code: string;
  language?: string;
  darkTheme?: boolean;
  className?: string;
  showLineNumbers?: boolean;
};

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

export function SyntaxHighlighter({ code, language, darkTheme, className, showLineNumbers }: SyntaxHighlighterProps) {
  const classNames = useOptionalContentClassNames();
  const style = darkTheme ? oneDark : oneLight;

  return (
    <div
      className={cn(
        'aui-syntax-highlighter my-2 max-w-full min-w-0 overflow-x-auto rounded-md',
        classNames.syntaxHighlighter?.root,
        className,
      )}
    >
      <PrismHighlighter
        language={language}
        style={style}
        customStyle={{ margin: 0, maxWidth: '100%' }}
        showLineNumbers={showLineNumbers}
        PreTag={({ children, className: preClass, ...rest }) => (
          <pre {...rest} className={cn('max-w-full overflow-x-auto', classNames.syntaxHighlighter?.pre, preClass)}>
            {children}
          </pre>
        )}
        CodeTag={({ children, className: codeClass, ...rest }) => (
          <code {...rest} className={cn(classNames.syntaxHighlighter?.code, codeClass)}>
            {applyLineNumberClassName(children, classNames.syntaxHighlighter?.lineNumber)}
          </code>
        )}
      >
        {code}
      </PrismHighlighter>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    SyntaxHighlighter: typeof SyntaxHighlighter;
  }
}
