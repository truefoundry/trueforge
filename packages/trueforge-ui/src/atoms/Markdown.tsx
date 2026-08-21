'use client';

import type { ComponentType, ReactNode } from 'react';
import { useMemo, useRef } from 'react';
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

/**
 * Prism cost grows with the code body. While the final fence is still open and changing, render
 * it as plain code above this size; closed fences remain highlighted and are not repeatedly
 * downgraded. The active fence is highlighted once when its closing delimiter arrives.
 */
export const LARGE_STREAMING_FENCE_CHARS = 8 * 1024;

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

/**
 * Body of the final unmatched fenced block while streaming, or null when every fence is closed.
 * Used so only the growing fence skips Prism — completed large fences stay highlighted.
 */
export function getActiveStreamingFenceCode(content: string): string | null {
  const re = /^(`{3,})([^\n]*)\n?/gm;
  const markers: Array<{ after: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    markers.push({ after: match.index + match[0].length });
  }
  if (markers.length % 2 === 0) return null;
  const open = markers[markers.length - 1];
  if (open == null) return null;
  return content.slice(open.after).replace(/\n$/, '');
}

function makeComponents(opts: {
  isStreaming?: boolean;
  /** Latest unmatched fence body; read via ref so `components` identity stays stable across growth. */
  getActiveFenceCode: () => string | null;
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
    getActiveFenceCode,
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
    // Chat markdown links should open in a new tab.
    a({ href, children, node: _node, ...props }) {
      return (
        <a {...props} href={href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    },
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
          <code
            className={cn('aui-inline-code rounded bg-secondary-bg px-1 py-0.5 font-mono text-sm', inlineCodeClassName)}
          >
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

      // Only the unmatched growing fence skips Prism; closed fences stay highlighted.
      const activeFenceCode = getActiveFenceCode();
      const isActiveOversizedFence =
        isStreaming === true &&
        activeFenceCode != null &&
        code === activeFenceCode &&
        code.length > LARGE_STREAMING_FENCE_CHARS;

      if (isActiveOversizedFence) {
        return (
          <pre
            className={cn(
              'aui-syntax-highlighter my-2 max-w-full min-w-0 overflow-x-auto whitespace-pre-wrap break-words rounded-md',
            )}
            data-testid="aui-plain-streaming-fence"
          >
            <code className={cn(className, 'whitespace-pre-wrap break-words')}>{code}</code>
          </pre>
        );
      }

      return <SyntaxHighlighter code={code} language={language} darkTheme={darkTheme} />;
    },
  };
}

const REMARK_PLUGINS = [remarkGfm];

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

  // Ref keeps `components` stable while the active fence grows so completed Prism trees do not remount.
  const activeFenceCodeRef = useRef<string | null>(null);
  activeFenceCodeRef.current = isStreaming === true ? getActiveStreamingFenceCode(content) : null;

  const components = useMemo(
    () =>
      makeComponents({
        isStreaming,
        getActiveFenceCode: () => activeFenceCodeRef.current,
        darkTheme,
        fileDownloadBaseUrl,
        onDownloadArtifact,
        readOnly,
        OpenUiFenceBlock,
        SandboxArtifactDownload,
        SyntaxHighlighter,
        inlineCodeClassName: classNames.inlineCode,
      }),
    [
      isStreaming,
      darkTheme,
      fileDownloadBaseUrl,
      onDownloadArtifact,
      readOnly,
      OpenUiFenceBlock,
      SandboxArtifactDownload,
      SyntaxHighlighter,
      classNames.inlineCode,
    ],
  );

  return (
    <div
      className={cn('aui-markdown markdown-body min-w-0 max-w-full overflow-x-clip', classNames.markdown, className)}
    >
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={components}>
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
