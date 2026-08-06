'use client';

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
        showLineNumbers={showLineNumbers}
        customStyle={{ margin: 0, maxWidth: '100%' }}
        PreTag={({ children, className: preClass, ...rest }) => (
          <pre {...rest} className={cn('max-w-full overflow-x-auto', classNames.syntaxHighlighter?.pre, preClass)}>
            {children}
          </pre>
        )}
        CodeTag={({ children, className: codeClass, ...rest }) => (
          <code {...rest} className={cn(classNames.syntaxHighlighter?.code, codeClass)}>
            {children}
          </code>
        )}
      >
        {code}
      </PrismHighlighter>
    </div>
  );
}
