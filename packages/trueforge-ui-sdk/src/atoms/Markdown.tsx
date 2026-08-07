'use client';

import type { ComponentType, ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { useSlot, useThemeMode } from '../theme/SlotsProvider.js';
import { useOptionalContentClassNames } from '../theme/ThemeProvider.js';
import { cn } from './lib/cn.js';
import type { OpenUiFenceBlockProps } from './OpenUiFenceBlock.js';
import type { SandboxArtifactDownloadProps } from './SandboxArtifactDownload.js';
import type { SyntaxHighlighterProps } from './SyntaxHighlighter.js';

/** Preloads OpenUiFenceBlock so it's ready before the user sees openui content. */
export function preloadMarkdownOpenUI(): Promise<unknown> {
  return import('./OpenUiFenceBlock.js');
}

export type MarkdownProps = {
  content: string;
  isStreaming?: boolean;
  /** Base URL for resolving sandbox artifact download paths (e.g. gateway file endpoint). */
  fileDownloadBaseUrl?: string;
  /** Custom download handler that receives the original sandbox artifact path. */
  onDownloadArtifact?: (path: string, filename: string) => Promise<void>;
  /** When true, download actions in sandbox artifact blocks are hidden/disabled. */
  readOnly?: boolean;
  className?: string;
};

function makeComponents(opts: {
  isStreaming?: boolean;
  darkTheme: boolean;
  fileDownloadBaseUrl?: string;
  onDownloadArtifact?: (path: string, filename: string) => Promise<void>;
  readOnly?: boolean;
  OpenUiFenceBlock: ComponentType<OpenUiFenceBlockProps>;
  SandboxArtifactDownload: ComponentType<SandboxArtifactDownloadProps>;
  SyntaxHighlighter: ComponentType<SyntaxHighlighterProps>;
  inlineCodeClassName?: string;
}): Components {
  const {
    isStreaming,
    darkTheme,
    fileDownloadBaseUrl,
    onDownloadArtifact,
    readOnly,
    OpenUiFenceBlock,
    SandboxArtifactDownload,
    SyntaxHighlighter,
    inlineCodeClassName,
  } = opts;

  return {
    // Strip default <pre> wrapper — each block renderer provides its own container.
    pre({ children }: { children?: ReactNode }) {
      return <>{children}</>;
    },
    code({ className, children }) {
      const language = /language-(\w+)/.exec(className ?? '')?.[1];
      const code = String(children ?? '').replace(/\n$/, '');

      // Inline code: no language class
      if (!className) {
        return (
          <code className={cn('aui-inline-code rounded bg-muted px-1 py-0.5 font-mono text-sm', inlineCodeClassName)}>
            {children}
          </code>
        );
      }

      if (language === 'openui') {
        return <OpenUiFenceBlock content={code} isStreaming={isStreaming} darkTheme={darkTheme} />;
      }

      if (language === 'sandbox_artifacts') {
        return (
          <SandboxArtifactDownload
            code={code}
            fileDownloadBaseUrl={fileDownloadBaseUrl}
            onDownloadArtifact={onDownloadArtifact}
            readOnly={readOnly}
          />
        );
      }

      return <SyntaxHighlighter code={code} language={language} darkTheme={darkTheme} />;
    },
  };
}

export function Markdown({
  content,
  isStreaming,
  fileDownloadBaseUrl,
  onDownloadArtifact,
  readOnly,
  className,
}: MarkdownProps) {
  const mode = useThemeMode();
  const classNames = useOptionalContentClassNames();
  const darkTheme = mode === 'dark';
  const OpenUiFenceBlock = useSlot('OpenUiFenceBlock');
  const SandboxArtifactDownload = useSlot('SandboxArtifactDownload');
  const SyntaxHighlighter = useSlot('SyntaxHighlighter');

  const components = makeComponents({
    isStreaming,
    darkTheme,
    fileDownloadBaseUrl,
    onDownloadArtifact,
    readOnly,
    OpenUiFenceBlock,
    SandboxArtifactDownload,
    SyntaxHighlighter,
    inlineCodeClassName: classNames.inlineCode,
  });

  return (
    <div
      className={cn('aui-markdown markdown-body min-w-0 max-w-full overflow-x-clip', classNames.markdown, className)}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

declare module '../theme/SlotsProvider.js' {
  interface AtomSlots {
    Markdown: typeof Markdown;
  }
}
